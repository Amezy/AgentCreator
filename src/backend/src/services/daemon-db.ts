/**
 * Read-only access to the daemon service's SQLite database.
 * Used to retrieve admin user accounts managed by aibox-daemon.
 *
 * Daemon DB path: /var/lib/aibox-daemon/aibox.db (default)
 * Falls back to searching common locations if the configured path doesn't exist.
 * Table: managed_users (username, uid, status, created_by, created_at, updated_at)
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import { CONFIG } from './config';

const FALLBACK_SEARCH_PATHS = [
  '/var/lib/aibox-daemon/aibox.db',
  '/opt/aibox/aibox.db',
  '/etc/aibox/aibox.db',
];

/**
 * Resolve the daemon DB path:
 * 1. Use CONFIG.DAEMON_DB_PATH if the file exists
 * 2. Check known fallback paths
 * 3. As last resort, run `find` to locate it
 */
function resolveDaemonDbPath(): string | null {
  // Priority 1: configured path
  if (fs.existsSync(CONFIG.DAEMON_DB_PATH)) {
    return CONFIG.DAEMON_DB_PATH;
  }

  // Priority 2: known fallback paths
  for (const p of FALLBACK_SEARCH_PATHS) {
    if (fs.existsSync(p)) {
      console.log(`[DaemonDB] Found daemon DB at fallback path: ${p}`);
      return p;
    }
  }

  // Priority 3: global search (slow, only runs once at startup)
  try {
    const result = execFileSync('find', ['/var', '/opt', '/etc', '-name', 'aibox.db', '-type', 'f'], {
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
    const firstMatch = result.split('\n')[0];
    if (firstMatch) {
      console.log(`[DaemonDB] Found daemon DB via search: ${firstMatch}`);
      return firstMatch;
    }
  } catch {
    // Search failed, ignore
  }

  console.warn(`[DaemonDB] Daemon database not found at ${CONFIG.DAEMON_DB_PATH} or any fallback path`);
  return null;
}

let daemonDb: Database.Database | null = null;
let resolvedPath: string | null = null;

function getDaemonDb(): Database.Database | null {
  if (daemonDb) return daemonDb;

  // Re-resolve path each time if not yet found (daemon DB may appear later)
  if (!resolvedPath) {
    resolvedPath = resolveDaemonDbPath();
  }
  if (!resolvedPath) return null;

  try {
    daemonDb = new Database(resolvedPath, { readonly: true });
    daemonDb.pragma('journal_mode = WAL');
    return daemonDb;
  } catch {
    console.warn(`[DaemonDB] Cannot open daemon database at ${resolvedPath}`);
    resolvedPath = null; // Reset so we retry next time
    return null;
  }
}

export interface DaemonManagedUser {
  id: number;
  username: string;
  uid: number;
  status: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/**
 * Find an admin user by username from the daemon's managed_users table.
 * Returns null if the daemon DB is unavailable or user not found.
 */
export function findDaemonAdmin(username: string): DaemonManagedUser | null {
  const db = getDaemonDb();
  if (!db) return null;

  try {
    const row = db
      .prepare('SELECT * FROM managed_users WHERE username = ? AND status = ?')
      .get(username, 'active') as DaemonManagedUser | undefined;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Find an admin user by ID from the daemon's managed_users table.
 * Returns null if the daemon DB is unavailable or user not found.
 */
export function findDaemonAdminById(id: number): DaemonManagedUser | null {
  const db = getDaemonDb();
  if (!db) return null;

  try {
    const row = db
      .prepare('SELECT * FROM managed_users WHERE id = ? AND status = ?')
      .get(id, 'active') as DaemonManagedUser | undefined;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * List all active admin users from daemon's managed_users table.
 */
export function listDaemonAdmins(): DaemonManagedUser[] {
  const db = getDaemonDb();
  if (!db) return [];

  try {
    return db
      .prepare('SELECT * FROM managed_users WHERE status = ? ORDER BY id ASC')
      .all('active') as DaemonManagedUser[];
  } catch {
    return [];
  }
}

/**
 * Get device config from daemon DB.
 */
export function getDaemonDeviceConfig(): Record<string, string> {
  const db = getDaemonDb();
  if (!db) return {};

  try {
    const rows = db
      .prepare('SELECT key, value FROM device_config')
      .all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Close the daemon DB connection (for graceful shutdown).
 */
export function closeDaemonDb(): void {
  if (daemonDb) {
    daemonDb.close();
    daemonDb = null;
  }
}
