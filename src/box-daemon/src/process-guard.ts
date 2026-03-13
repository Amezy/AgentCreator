import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
const PID_DIR = path.join(os.tmpdir(), 'aibox-pids');

function ensurePidDir(): void {
  if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR, { recursive: true });
}

function writePidFile(name: string, pid: number): void {
  ensurePidDir();
  fs.writeFileSync(path.join(PID_DIR, `${name}.pid`), String(pid));
}

function removePidFile(name: string): void {
  try { fs.unlinkSync(path.join(PID_DIR, `${name}.pid`)); } catch { /* already gone */ }
}

/** Kill orphan processes from a previous crash using saved PID files */
export function cleanupOrphanProcesses(): void {
  ensurePidDir();
  let files: string[];
  try { files = fs.readdirSync(PID_DIR).filter(f => f.endsWith('.pid')); } catch { return; }
  for (const file of files) {
    try {
      const pid = parseInt(fs.readFileSync(path.join(PID_DIR, file), 'utf-8').trim(), 10);
      if (!isNaN(pid)) {
        process.kill(pid, 'SIGTERM');
        logProcessEvent({ process: file.replace('.pid', ''), event: 'orphan_killed', message: `Killed orphan PID ${pid}` });
      }
    } catch { /* process already gone */ }
    try { fs.unlinkSync(path.join(PID_DIR, file)); } catch { /* ignore */ }
  }
}

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

  if (child.pid) writePidFile(name, child.pid);
  logProcessEvent({ process: name, event: 'started', message: `PID ${child.pid}` });

  child.stdout?.on('data', (data) => {
    // Optionally pipe to daemon logger
  });

  child.stderr?.on('data', (data) => {
    console.error(`[${name}] ${data.toString().trim()}`);
  });

  child.on('exit', (code, signal) => {
    removePidFile(name);
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
      removePidFile(name);
    }
  }
  healthTimers.clear();
}

/** Stop all processes and wait for them to exit (with timeout) */
export async function stopAllProcessesGracefully(timeoutMs = 5000): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [name, entry] of processes) {
    const timer = healthTimers.get(name);
    if (timer) clearInterval(timer);
    if (entry.child && entry.child.exitCode === null) {
      promises.push(new Promise<void>((resolve) => {
        const forceKill = setTimeout(() => {
          entry.child?.kill('SIGKILL');
          removePidFile(name);
          resolve();
        }, timeoutMs);
        entry.child!.once('exit', () => {
          clearTimeout(forceKill);
          removePidFile(name);
          resolve();
        });
        entry.child!.removeAllListeners('exit');
        entry.child!.on('exit', () => { /* handled above */ });
        entry.child!.kill('SIGTERM');
      }));
    }
  }
  healthTimers.clear();
  await Promise.all(promises);
}
