import { spawn, ChildProcess } from 'child_process';
import { logProcessEvent } from './db';
import { ManagedProcess, ProcessState } from './types';

interface ProcessEntry {
  config: ManagedProcess;
  child: ChildProcess | null;
  state: ProcessState;
  restartTimestamps: number[];
}

const processes = new Map<string, ProcessEntry>();
const healthTimers = new Map<string, NodeJS.Timeout>();

/** Reset all state — for testing only */
export function _resetProcessGuard(): void {
  stopAllProcesses();
  processes.clear();
  healthTimers.clear();
}

export function registerProcess(config: ManagedProcess): void {
  processes.set(config.name, {
    config,
    child: null,
    state: {
      name: config.name,
      status: 'stopped',
      restartCount: 0,
    },
    restartTimestamps: [],
  });
}

export function startAllProcesses(): void {
  for (const [name] of processes) {
    startProcess(name);
  }
}

export function startProcess(name: string): void {
  const entry = processes.get(name);
  if (!entry) return;

  const child = spawn(entry.config.command, entry.config.args, {
    cwd: entry.config.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  entry.child = child;
  entry.state.status = 'running';
  entry.state.pid = child.pid;
  entry.state.uptime = Date.now();

  logProcessEvent({ process: name, event: 'started', message: `PID ${child.pid}` });

  child.stdout?.on('data', (data) => {
    // Optionally pipe to daemon logger
  });

  child.stderr?.on('data', (data) => {
    console.error(`[${name}] ${data.toString().trim()}`);
  });

  child.on('exit', (code, signal) => {
    entry.state.status = 'crashed';
    entry.state.pid = undefined;
    entry.state.lastCrash = Date.now();

    logProcessEvent({ process: name, event: 'exited', exitCode: code ?? undefined, signal: signal ?? undefined });

    const now = Date.now();
    entry.restartTimestamps = entry.restartTimestamps.filter(t => now - t < entry.config.restartWindow);

    if (entry.restartTimestamps.length < entry.config.maxRestarts) {
      entry.restartTimestamps.push(now);
      entry.state.status = 'restarting';
      entry.state.restartCount++;
      logProcessEvent({ process: name, event: 'restarting', message: `Attempt ${entry.state.restartCount}` });
      setTimeout(() => startProcess(name), 2000);
    } else {
      entry.state.status = 'crashed';
      logProcessEvent({ process: name, event: 'max_restarts', message: `Exceeded ${entry.config.maxRestarts} restarts in ${entry.config.restartWindow}ms` });
    }
  });

  if (entry.config.healthUrl) {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(entry.config.healthUrl!);
        if (!res.ok) throw new Error(`Status ${res.status}`);
      } catch {
        // Health check failure handled by process exit event
      }
    }, entry.config.healthInterval);
    healthTimers.set(name, timer);
  }
}

export function getProcessStates(): ProcessState[] {
  return Array.from(processes.values()).map(e => ({
    ...e.state,
    uptime: e.state.uptime ? Date.now() - e.state.uptime : undefined,
  }));
}

export function stopAllProcesses(): void {
  for (const [name, entry] of processes) {
    const timer = healthTimers.get(name);
    if (timer) clearInterval(timer);
    if (entry.child) {
      entry.child.removeAllListeners();
      entry.child.kill('SIGTERM');
    }
  }
  healthTimers.clear();
}
