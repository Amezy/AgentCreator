import os from 'os';
import dns from 'dns';
import { getDb } from '../db/connection';
import { broadcast } from './ws-hub';
import { recordSystemEvent } from './event-logger';
import { AgentInstance, SystemEvent } from '../types';
import { createChildLogger } from './logger';

const log = createChildLogger('Daemon');

// ==================== Types ====================

interface ResourceUsage {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  diskPercent: number;
}

interface DaemonState {
  isRunning: boolean;
  networkOnline: boolean;
  resourceUsage: ResourceUsage;
}

// ==================== State ====================

let isRunning = false;
let networkOnline = true;
let currentResourceUsage: ResourceUsage = {
  cpuPercent: 0,
  memoryPercent: 0,
  memoryUsedMB: 0,
  memoryTotalMB: 0,
  diskPercent: 50, // Mock default
};

let resourceCheckInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatCheckInterval: ReturnType<typeof setInterval> | null = null;
let networkCheckInterval: ReturnType<typeof setInterval> | null = null;

// Track previous CPU usage for delta calculation
let previousCpuTimes: { idle: number; total: number } | null = null;

const RESOURCE_CHECK_MS = 10_000;    // 10 seconds
const HEARTBEAT_CHECK_MS = 15_000;   // 15 seconds
const NETWORK_CHECK_MS = 30_000;     // 30 seconds
const HEARTBEAT_TIMEOUT_S = 60;      // 60 seconds

const MEMORY_WARN_THRESHOLD = 85;
const MEMORY_CRITICAL_THRESHOLD = 95;

// ==================== Public API ====================

/**
 * Start the Root Daemon. Begins periodic checks for resources, heartbeats, and network.
 */
export function startDaemon(): void {
  if (isRunning) {
    log.warn('Already running');
    return;
  }

  isRunning = true;
  log.info('Starting Root Daemon...');

  // Initial checks
  updateResourceUsage();
  checkNetwork();

  // Start periodic tasks
  resourceCheckInterval = setInterval(() => {
    updateResourceUsage();
    checkResourceAlerts();
  }, RESOURCE_CHECK_MS);

  heartbeatCheckInterval = setInterval(() => {
    checkAgentHeartbeats();
  }, HEARTBEAT_CHECK_MS);

  networkCheckInterval = setInterval(() => {
    checkNetwork();
  }, NETWORK_CHECK_MS);

  // Record daemon start event
  recordSystemEvent('agent_start', null, 'info', 'Root Daemon started', undefined, 'Daemon');

  broadcast('system:alert', {
    level: 'info',
    resource: 'daemon',
    message: 'Root Daemon started',
  });

  log.info('Root Daemon started successfully');
}

/**
 * Stop the Root Daemon. Clears all periodic tasks.
 */
export function stopDaemon(): void {
  if (!isRunning) {
    log.warn('Not running');
    return;
  }

  if (resourceCheckInterval) {
    clearInterval(resourceCheckInterval);
    resourceCheckInterval = null;
  }
  if (heartbeatCheckInterval) {
    clearInterval(heartbeatCheckInterval);
    heartbeatCheckInterval = null;
  }
  if (networkCheckInterval) {
    clearInterval(networkCheckInterval);
    networkCheckInterval = null;
  }

  isRunning = false;
  previousCpuTimes = null;

  recordSystemEvent('agent_stop', null, 'info', 'Root Daemon stopped', undefined, 'Daemon');

  broadcast('system:alert', {
    level: 'info',
    resource: 'daemon',
    message: 'Root Daemon stopped',
  });

  log.info('Root Daemon stopped');
}

/**
 * Get the current daemon state.
 */
export function getDaemonState(): DaemonState {
  return {
    isRunning,
    networkOnline,
    resourceUsage: { ...currentResourceUsage },
  };
}

/**
 * Get the current resource usage snapshot.
 */
export function getResourceUsage(): ResourceUsage {
  return { ...currentResourceUsage };
}

/**
 * Freeze (suspend) all non-suspended agents. Used for emergency situations.
 */
export function freezeAllAgents(reason: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const agents = db.prepare(
    "SELECT id, role FROM agent_instances WHERE status != 'suspended'"
  ).all() as Pick<AgentInstance, 'id' | 'role'>[];

  if (agents.length === 0) {
    log.info('No active agents to freeze');
    return;
  }

  const stmt = db.prepare(
    "UPDATE agent_instances SET status = 'suspended', updated_at = ? WHERE id = ?"
  );

  const transaction = db.transaction(() => {
    for (const agent of agents) {
      stmt.run(now, agent.id);
    }
  });
  transaction();

  // Record event
  recordSystemEvent(
    'network_freeze',
    null,
    'critical',
    `All agents frozen: ${reason}`,
    JSON.stringify({ affected_agents: agents.map((a) => a.id), reason }),
    'Daemon'
  );

  // Broadcast freeze event for each agent
  for (const agent of agents) {
    broadcast('agent:status', {
      agent_id: agent.id,
      role: agent.role,
      status: 'suspended',
    });
  }

  broadcast('system:alert', {
    level: 'critical',
    resource: 'agents',
    message: `All agents frozen: ${reason}`,
    affected_count: agents.length,
  });

  log.info({ count: agents.length, reason }, 'Froze agents');
}

/**
 * Resume all suspended agents back to idle.
 */
export function resumeAllAgents(): void {
  const db = getDb();
  const now = new Date().toISOString();

  const agents = db.prepare(
    "SELECT id, role FROM agent_instances WHERE status = 'suspended'"
  ).all() as Pick<AgentInstance, 'id' | 'role'>[];

  if (agents.length === 0) {
    log.info('No suspended agents to resume');
    return;
  }

  const stmt = db.prepare(
    "UPDATE agent_instances SET status = 'idle', updated_at = ? WHERE id = ?"
  );

  const transaction = db.transaction(() => {
    for (const agent of agents) {
      stmt.run(now, agent.id);
    }
  });
  transaction();

  // Broadcast resume event for each agent
  for (const agent of agents) {
    broadcast('agent:status', {
      agent_id: agent.id,
      role: agent.role,
      status: 'idle',
    });
  }

  broadcast('system:alert', {
    level: 'info',
    resource: 'agents',
    message: 'All suspended agents resumed',
    affected_count: agents.length,
  });

  log.info({ count: agents.length }, 'Resumed agents');
}

// ==================== Internal Functions ====================

/**
 * Calculate and update current resource usage.
 */
function updateResourceUsage(): void {
  // --- Memory ---
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = totalMemBytes - freeMemBytes;

  const memoryTotalMB = Math.round(totalMemBytes / (1024 * 1024));
  const memoryUsedMB = Math.round(usedMemBytes / (1024 * 1024));
  const memoryPercent = Math.round((usedMemBytes / totalMemBytes) * 100);

  // --- CPU ---
  const cpus = os.cpus();
  let idleTotal = 0;
  let cpuTotal = 0;

  for (const cpu of cpus) {
    idleTotal += cpu.times.idle;
    cpuTotal += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }

  let cpuPercent = 0;
  if (previousCpuTimes) {
    const idleDiff = idleTotal - previousCpuTimes.idle;
    const totalDiff = cpuTotal - previousCpuTimes.total;
    if (totalDiff > 0) {
      cpuPercent = Math.round((1 - idleDiff / totalDiff) * 100);
    }
  }
  previousCpuTimes = { idle: idleTotal, total: cpuTotal };

  // --- Disk (mock on macOS, real implementation would use child_process) ---
  const diskPercent = 50; // Mock value

  currentResourceUsage = {
    cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
    memoryPercent,
    memoryUsedMB,
    memoryTotalMB,
    diskPercent,
  };
}

/**
 * Check resource thresholds and emit alerts if needed.
 */
function checkResourceAlerts(): void {
  const { memoryPercent } = currentResourceUsage;

  if (memoryPercent >= MEMORY_CRITICAL_THRESHOLD) {
    log.warn({ memoryPercent }, 'CRITICAL: Memory high, suspending non-core agents');

    recordSystemEvent(
      'resource_alert',
      null,
      'critical',
      `Memory critical: ${memoryPercent}% used`,
      JSON.stringify(currentResourceUsage),
      'Daemon'
    );

    broadcast('system:alert', {
      level: 'critical',
      resource: 'memory',
      usage_percent: memoryPercent,
      message: `Memory critical: ${memoryPercent}% used. Suspending non-core agents.`,
    });

    suspendNonCoreAgents();
  } else if (memoryPercent >= MEMORY_WARN_THRESHOLD) {
    log.warn({ memoryPercent }, 'Memory warning');

    recordSystemEvent(
      'resource_alert',
      null,
      'warn',
      `Memory warning: ${memoryPercent}% used`,
      JSON.stringify(currentResourceUsage),
      'Daemon'
    );

    broadcast('system:alert', {
      level: 'warn',
      resource: 'memory',
      usage_percent: memoryPercent,
      message: `Memory warning: ${memoryPercent}% used`,
    });
  }
}

/**
 * Suspend non-core agents (everything except architect) to free resources.
 */
function suspendNonCoreAgents(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Keep architect alive, suspend the rest
  const agents = db.prepare(
    "SELECT id, role FROM agent_instances WHERE role != 'architect' AND status NOT IN ('suspended', 'error')"
  ).all() as Pick<AgentInstance, 'id' | 'role'>[];

  if (agents.length === 0) return;

  const stmt = db.prepare(
    "UPDATE agent_instances SET status = 'suspended', updated_at = ? WHERE id = ?"
  );

  const transaction = db.transaction(() => {
    for (const agent of agents) {
      stmt.run(now, agent.id);
    }
  });
  transaction();

  for (const agent of agents) {
    broadcast('agent:status', {
      agent_id: agent.id,
      role: agent.role,
      status: 'suspended',
    });
  }

  log.info({ count: agents.length }, 'Suspended non-core agents due to high memory');
}

/**
 * Check agent heartbeats and mark stale agents as error.
 */
function checkAgentHeartbeats(): void {
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();

  // Get all active agents (not suspended/error) with a heartbeat
  const agents = db.prepare(
    "SELECT id, role, last_heartbeat FROM agent_instances WHERE status NOT IN ('suspended', 'error') AND last_heartbeat IS NOT NULL"
  ).all() as Pick<AgentInstance, 'id' | 'role' | 'last_heartbeat'>[];

  for (const agent of agents) {
    if (!agent.last_heartbeat) continue;

    const lastBeat = new Date(agent.last_heartbeat);
    const diffSeconds = (now.getTime() - lastBeat.getTime()) / 1000;

    if (diffSeconds > HEARTBEAT_TIMEOUT_S) {
      log.warn({ agentId: agent.id, role: agent.role, timeoutSeconds: Math.round(diffSeconds) }, 'Agent heartbeat timeout');

      db.prepare(
        "UPDATE agent_instances SET status = 'error', error_log = ?, updated_at = ? WHERE id = ?"
      ).run(`Heartbeat timeout: ${Math.round(diffSeconds)}s since last heartbeat`, nowIso, agent.id);

      recordSystemEvent(
        'agent_error',
        agent.id,
        'error',
        `Agent ${agent.role} heartbeat timeout (${Math.round(diffSeconds)}s)`,
        JSON.stringify({ agent_id: agent.id, role: agent.role, timeout_seconds: Math.round(diffSeconds) }),
        'Daemon'
      );

      broadcast('agent:status', {
        agent_id: agent.id,
        role: agent.role,
        status: 'error',
      });
    }
  }
}

/**
 * Check network connectivity via DNS lookup.
 */
function checkNetwork(): void {
  dns.lookup('dns.google', (err) => {
    const wasOnline = networkOnline;
    networkOnline = !err;

    if (wasOnline && !networkOnline) {
      log.warn('Network went offline');
      recordSystemEvent('network_freeze', null, 'warn', 'Network connectivity lost', undefined, 'Daemon');
      broadcast('system:alert', {
        level: 'warn',
        resource: 'network',
        message: 'Network connectivity lost',
      });
    } else if (!wasOnline && networkOnline) {
      log.info('Network restored');
      broadcast('system:alert', {
        level: 'info',
        resource: 'network',
        message: 'Network connectivity restored',
      });
    }
  });
}

