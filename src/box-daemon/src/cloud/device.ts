import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import { HardwareInfo } from './types';

// DMI paths to try for serial number (matches Python: 3 paths)
const SN_PATHS = [
  '/sys/class/dmi/id/product_serial',
  '/sys/class/dmi/id/board_serial',
  '/sys/class/dmi/id/chassis_serial',
];

// Invalid SN values to skip (matches Python _SN_INVALID set exactly)
const SN_INVALID = new Set([
  '', 'None', 'Default string',
  'To Be Filled By O.E.M.', 'To be filled by O.E.M.',
]);

/**
 * Check if a network interface is a physical NIC.
 * Physical NICs have a /sys/class/net/{iface}/device symlink.
 * Matches Python _is_physical_iface() logic.
 */
function isPhysicalIface(iface: string): boolean {
  return fs.existsSync(`/sys/class/net/${iface}/device`);
}

/**
 * Read MAC address from /sys/class/net/{iface}/address.
 */
function readIfaceMac(iface: string): string {
  try {
    const mac = fs.readFileSync(`/sys/class/net/${iface}/address`, 'utf-8').trim();
    if (mac && mac !== '00:00:00:00:00:00') {
      return mac.toUpperCase();
    }
  } catch {}
  return '';
}

/**
 * Read MAC address of the first physical network interface.
 * Prioritizes physical NICs (enp*, eth*, etc.) over virtual interfaces.
 * Matches Python _read_mac_address() logic.
 */
function readMacAddress(): string {
  let ifaces: string[];
  try {
    ifaces = fs.readdirSync('/sys/class/net').sort();
  } catch {
    return '';
  }

  // First pass: physical NICs only
  for (const iface of ifaces) {
    if (iface === 'lo' || !isPhysicalIface(iface)) continue;
    const mac = readIfaceMac(iface);
    if (mac) return mac;
  }

  // Fallback: any non-loopback interface
  for (const iface of ifaces) {
    if (iface === 'lo') continue;
    const mac = readIfaceMac(iface);
    if (mac) return mac;
  }

  return '';
}

/**
 * Read device serial number with three-level fallback:
 * 1. DMI sysfs (product_serial, board_serial, chassis_serial)
 * 2. First physical NIC MAC address
 * 3. Hostname
 * Matches Python read_serial_number() logic.
 */
/**
 * Read a DMI file, falling back to sudo if permission denied.
 * DMI sysfs files are root-only (-r--------), boxsystem user needs sudo.
 */
function readDmiFile(path: string): string {
  try {
    return fs.readFileSync(path, 'utf-8').trim();
  } catch {
    // Permission denied — try with sudo
    try {
      return execFileSync('sudo', ['cat', path], { timeout: 3000 }).toString().trim();
    } catch {}
  }
  return '';
}

export function readSerialNumber(): string {
  for (const p of SN_PATHS) {
    const sn = readDmiFile(p);
    if (sn && !SN_INVALID.has(sn)) {
      return sn;
    }
  }

  // Fallback: MAC address
  const mac = readMacAddress();
  if (mac) return mac;

  // Last resort: hostname
  return os.hostname();
}

/**
 * Generate a deterministic box_id from the serial number.
 * Format: box-<sanitised_sn>
 * Matches Python generate_box_id() logic exactly.
 */
export function generateBoxId(sn: string): string {
  // Remove non-alphanumeric characters (matches Python: only keep a-zA-Z0-9)
  let sanitized = sn.replace(/[^a-zA-Z0-9]/g, '');
  if (!sanitized) {
    // Very unlikely, but hash the raw input as last resort (matches Python)
    sanitized = crypto.createHash('sha256').update(sn).digest('hex').substring(0, 12);
  }
  return `box-${sanitized}`;
}

/**
 * Get CPU model string from /proc/cpuinfo (matches Python).
 */
function getCpuModel(): string {
  try {
    const content = fs.readFileSync('/proc/cpuinfo', 'utf-8');
    for (const line of content.split('\n')) {
      if (line.startsWith('model name')) {
        return line.split(':')[1]?.trim() || 'unknown';
      }
    }
  } catch {}
  // Fallback to os.cpus()
  const cpus = os.cpus();
  return cpus.length > 0 ? cpus[0].model : 'unknown';
}

/**
 * Get total memory in GB (rounded to integer, matches Python).
 */
function getTotalMemoryGb(): number {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf-8');
    for (const line of content.split('\n')) {
      if (line.startsWith('MemTotal')) {
        const kb = parseInt(line.split(/\s+/)[1], 10);
        return Math.round(kb / (1024 * 1024));
      }
    }
  } catch {}
  return Math.round(os.totalmem() / (1024 * 1024 * 1024));
}

/**
 * Get total disk size in GB (matches Python os.statvfs logic).
 */
function getTotalDiskGb(): number {
  try {
    const stat = fs.statfsSync('/');
    return Math.round((stat.blocks * stat.bsize) / (1024 ** 3));
  } catch {}
  return 0;
}

/**
 * Gather full hardware info for registration.
 * Accepts optional serial_number to avoid re-reading (matches Python pattern).
 */
export function getHardwareInfo(serialNumber?: string): HardwareInfo {
  const sn = serialNumber || readSerialNumber();
  return {
    cpu: getCpuModel(),
    memory_gb: getTotalMemoryGb(),
    disk_gb: getTotalDiskGb(),
    mac_address: readMacAddress(),
    serial_number: sn,
  };
}
