import crypto from 'crypto';
import { getDb } from '../db/connection';
import { broadcast } from './ws-hub';
import { recordSystemEvent } from './event-logger';
import { AgentInstance, SystemEvent } from '../types';

// ==================== Types ====================

interface AgentInfo {
  id: number;
  role: string;
  status: string;
  model_name: string;
  error_count: number;
  last_heartbeat: string | null;
}

interface AgentLogEntry {
  id: number;
  event_type: string;
  severity: string;
  message: string;
  metadata_json: string | null;
  created_at: string;
}

// ==================== Constants ====================

const CIRCUIT_BREAK_THRESHOLD = 3;

// ==================== Public API ====================

/**
 * Launch a new Agent instance. Inserts a record into agent_instances,
 * assigns a mock container_id, and broadcasts the creation event.
 */
export function launchAgent(
  teamConfigId: number,
  role: string,
  modelName: string
): AgentInfo {
  const db = getDb();
  const now = new Date().toISOString();
  const mockContainerId = `swt-${role}-${crypto.randomUUID()}`;

  const result = db.prepare(
    `INSERT INTO agent_instances (team_config_id, role, container_id, status, model_name, last_heartbeat, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', ?, ?, ?, ?)`
  ).run(teamConfigId, role, mockContainerId, modelName, now, now, now);

  const agentId = Number(result.lastInsertRowid);

  // Record system event
  recordSystemEvent(
    'agent_start',
    agentId,
    'info',
    `Agent ${role} launched with model ${modelName}`,
    JSON.stringify({ team_config_id: teamConfigId, container_id: mockContainerId, model_name: modelName }),
    'AgentManager'
  );

  // Broadcast
  broadcast('agent:status', {
    agent_id: agentId,
    role,
    status: 'idle',
  });

  console.log(`[AgentManager] Launched agent ${agentId} (${role}) with model ${modelName}`);

  return {
    id: agentId,
    role,
    status: 'idle',
    model_name: modelName,
    error_count: 0,
    last_heartbeat: now,
  };
}

/**
 * Stop an Agent instance by setting its status to suspended.
 */
export function stopAgent(agentId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const agent = db.prepare(
    'SELECT id, role FROM agent_instances WHERE id = ?'
  ).get(agentId) as Pick<AgentInstance, 'id' | 'role'> | undefined;

  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  db.prepare(
    "UPDATE agent_instances SET status = 'suspended', updated_at = ? WHERE id = ?"
  ).run(now, agentId);

  recordSystemEvent(
    'agent_stop',
    agentId,
    'info',
    `Agent ${agent.role} stopped`,
    JSON.stringify({ agent_id: agentId, role: agent.role }),
    'AgentManager'
  );

  broadcast('agent:status', {
    agent_id: agentId,
    role: agent.role,
    status: 'suspended',
  });

  console.log(`[AgentManager] Stopped agent ${agentId} (${agent.role})`);
}

/**
 * Get the current status/info of a single agent.
 */
export function getAgentStatus(agentId: number): AgentInfo | null {
  const db = getDb();

  const row = db.prepare(
    'SELECT id, role, status, model_name, error_count, last_heartbeat FROM agent_instances WHERE id = ?'
  ).get(agentId) as AgentInfo | undefined;

  return row || null;
}

/**
 * Get all agents, optionally filtered by team_config_id.
 */
export function getAllAgents(teamConfigId?: number): AgentInfo[] {
  const db = getDb();

  if (teamConfigId !== undefined) {
    return db.prepare(
      'SELECT id, role, status, model_name, error_count, last_heartbeat FROM agent_instances WHERE team_config_id = ? ORDER BY id'
    ).all(teamConfigId) as AgentInfo[];
  }

  return db.prepare(
    'SELECT id, role, status, model_name, error_count, last_heartbeat FROM agent_instances ORDER BY id'
  ).all() as AgentInfo[];
}

/**
 * Update an agent's status and refresh last_heartbeat.
 */
export function updateAgentStatus(agentId: number, status: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const agent = db.prepare(
    'SELECT id, role FROM agent_instances WHERE id = ?'
  ).get(agentId) as Pick<AgentInstance, 'id' | 'role'> | undefined;

  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  db.prepare(
    'UPDATE agent_instances SET status = ?, last_heartbeat = ?, updated_at = ? WHERE id = ?'
  ).run(status, now, now, agentId);

  broadcast('agent:status', {
    agent_id: agentId,
    role: agent.role,
    status,
  });
}

/**
 * Report an error for an agent. Increments error_count, records the error log,
 * and triggers circuit break if threshold is reached.
 */
export function reportAgentError(agentId: number, errorLog: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const agent = db.prepare(
    'SELECT id, role, error_count FROM agent_instances WHERE id = ?'
  ).get(agentId) as Pick<AgentInstance, 'id' | 'role' | 'error_count'> | undefined;

  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const newErrorCount = agent.error_count + 1;

  // Record the error event
  recordSystemEvent(
    'agent_error',
    agentId,
    'error',
    `Agent ${agent.role} error: ${errorLog}`,
    JSON.stringify({ agent_id: agentId, role: agent.role, error_count: newErrorCount, error_log: errorLog }),
    'AgentManager'
  );

  // Check circuit break threshold
  if (newErrorCount >= CIRCUIT_BREAK_THRESHOLD) {
    // Circuit break: force suspend
    db.prepare(
      "UPDATE agent_instances SET status = 'suspended', error_count = ?, error_log = ?, updated_at = ? WHERE id = ?"
    ).run(newErrorCount, errorLog, now, agentId);

    recordSystemEvent(
      'circuit_break',
      agentId,
      'critical',
      `Circuit break triggered for agent ${agent.role}: ${newErrorCount} consecutive errors`,
      JSON.stringify({ agent_id: agentId, role: agent.role, error_count: newErrorCount, last_error: errorLog }),
      'AgentManager'
    );

    broadcast('agent:circuit_break', {
      agent_id: agentId,
      role: agent.role,
      reason: `${newErrorCount} consecutive errors, last: ${errorLog}`,
      error_count: newErrorCount,
    });

    broadcast('agent:status', {
      agent_id: agentId,
      role: agent.role,
      status: 'suspended',
    });

    console.warn(`[AgentManager] Circuit break for agent ${agentId} (${agent.role}): ${newErrorCount} errors`);
  } else {
    // Update error count but keep current status (or set to error)
    db.prepare(
      "UPDATE agent_instances SET status = 'error', error_count = ?, error_log = ?, updated_at = ? WHERE id = ?"
    ).run(newErrorCount, errorLog, now, agentId);

    broadcast('agent:status', {
      agent_id: agentId,
      role: agent.role,
      status: 'error',
    });

    console.warn(`[AgentManager] Agent ${agentId} (${agent.role}) error #${newErrorCount}: ${errorLog}`);
  }
}

/**
 * Resume a suspended/errored agent. Resets error_count to 0 and sets status to idle.
 */
export function resumeAgent(agentId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const agent = db.prepare(
    'SELECT id, role FROM agent_instances WHERE id = ?'
  ).get(agentId) as Pick<AgentInstance, 'id' | 'role'> | undefined;

  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  db.prepare(
    "UPDATE agent_instances SET status = 'idle', error_count = 0, error_log = NULL, last_heartbeat = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, agentId);

  recordSystemEvent(
    'agent_start',
    agentId,
    'info',
    `Agent ${agent.role} resumed`,
    JSON.stringify({ agent_id: agentId, role: agent.role }),
    'AgentManager'
  );

  broadcast('agent:status', {
    agent_id: agentId,
    role: agent.role,
    status: 'idle',
  });

  console.log(`[AgentManager] Resumed agent ${agentId} (${agent.role})`);
}

/**
 * Get paginated event logs for a specific agent.
 */
export function getAgentLogs(
  agentId: number,
  page: number,
  limit: number
): { logs: string[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * limit;

  const countResult = db.prepare(
    'SELECT COUNT(*) as total FROM system_events WHERE agent_id = ?'
  ).get(agentId) as { total: number };

  const rows = db.prepare(
    'SELECT id, event_type, severity, message, metadata_json, created_at FROM system_events WHERE agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(agentId, limit, offset) as AgentLogEntry[];

  // Format logs as readable strings
  const logs = rows.map((row) => {
    return `[${row.created_at}] [${row.severity.toUpperCase()}] ${row.event_type}: ${row.message}`;
  });

  return {
    logs,
    total: countResult.total,
  };
}

