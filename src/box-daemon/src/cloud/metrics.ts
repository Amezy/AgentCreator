import fs from 'fs';
import os from 'os';

// ── CPU Usage (delta-based from /proc/stat) ──

interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

let prevCpu: CpuTimes | null = null;

function readCpuTimes(): CpuTimes | null {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf-8').split('\n')[0]; // "cpu  ..."
    const parts = line.split(/\s+/).slice(1).map(Number);
    return {
      user: parts[0], nice: parts[1], system: parts[2], idle: parts[3],
      iowait: parts[4] || 0, irq: parts[5] || 0, softirq: parts[6] || 0, steal: parts[7] || 0,
    };
  } catch {
    return null;
  }
}

export function getCpuUsage(): number {
  const cur = readCpuTimes();
  if (!cur) return os.loadavg()[0] / os.cpus().length * 100; // fallback

  if (!prevCpu) {
    prevCpu = cur;
    return os.loadavg()[0] / os.cpus().length * 100; // first call, no delta
  }

  const prev = prevCpu;
  prevCpu = cur;

  const dUser = cur.user - prev.user + (cur.nice - prev.nice);
  const dSystem = cur.system - prev.system + (cur.irq - prev.irq) + (cur.softirq - prev.softirq);
  const dIdle = cur.idle - prev.idle + (cur.iowait - prev.iowait);
  const dSteal = cur.steal - prev.steal;
  const total = dUser + dSystem + dIdle + dSteal;

  if (total === 0) return 0;
  return Math.round(((dUser + dSystem + dSteal) / total) * 1000) / 10; // one decimal
}

// ── Memory Usage ──

export function getMemoryUsage(): number {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf-8');
    const getValue = (key: string): number => {
      const match = content.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? parseInt(match[1], 10) : 0;
    };
    const total = getValue('MemTotal');
    const available = getValue('MemAvailable');
    if (total === 0) return 0;
    return Math.round(((total - available) / total) * 1000) / 10;
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    return Math.round(((total - free) / total) * 1000) / 10;
  }
}

// ── Disk Usage (matches Python os.statvfs logic) ──

export function getDiskUsage(): number {
  try {
    const stat = fs.statfsSync('/');
    const total = stat.blocks * stat.bsize;
    const free = stat.bfree * stat.bsize;
    if (total === 0) return 0;
    return Math.round((1 - free / total) * 1000) / 10;
  } catch {
    return 0;
  }
}

// ── Load Average ──

export function getLoadAvg(): number[] {
  return os.loadavg().map(v => Math.round(v * 100) / 100);
}

// ── Network Delta ──

interface NetCounters {
  rx: number;
  tx: number;
}

let prevNet: NetCounters | null = null;

function readNetCounters(): NetCounters | null {
  try {
    const content = fs.readFileSync('/proc/net/dev', 'utf-8');
    let rx = 0, tx = 0;
    for (const line of content.split('\n').slice(2)) { // skip header lines
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(':', '');
      if (iface === 'lo') continue; // skip loopback
      rx += parseInt(parts[1], 10);
      tx += parseInt(parts[9], 10);
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

export function getNetworkDelta(): { rx_bytes: number; tx_bytes: number } {
  const cur = readNetCounters();
  if (!cur) return { rx_bytes: 0, tx_bytes: 0 };

  if (!prevNet) {
    prevNet = cur;
    return { rx_bytes: 0, tx_bytes: 0 };
  }

  const delta = {
    rx_bytes: Math.max(0, cur.rx - prevNet.rx),
    tx_bytes: Math.max(0, cur.tx - prevNet.tx),
  };
  prevNet = cur;
  return delta;
}

// ── Process Count ──

export function getProcessCount(): number {
  try {
    const dirs = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
    return dirs.length;
  } catch {
    return 0;
  }
}

// ── Uptime ──

export function getUptime(): number {
  try {
    const content = fs.readFileSync('/proc/uptime', 'utf-8');
    return Math.floor(parseFloat(content.split(' ')[0]));
  } catch {
    return Math.floor(os.uptime());
  }
}

// ── Collect All Metrics ──

export function collectAll(managedUsersCount: number) {
  return {
    uptime: getUptime(),
    cpu_usage: getCpuUsage(),
    memory_usage: getMemoryUsage(),
    disk_usage: getDiskUsage(),
    load_avg: getLoadAvg(),
    network: getNetworkDelta(),
    processes: getProcessCount(),
    managed_users_count: managedUsersCount,
  };
}
