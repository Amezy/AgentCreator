import { getDb } from '../../db';
import { nowUnix } from '../types';

export interface ManagedUserRow {
  username: string;
  uid: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

/** Create a managed user record */
export function createManagedUser(username: string, uid: number | null): void {
  const now = nowUnix();
  getDb().prepare(
    'INSERT OR REPLACE INTO managed_users (username, uid, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(username, uid, 'active', now, now);
}

/** Get a managed user by username */
export function getManagedUser(username: string): ManagedUserRow | null {
  return (getDb().prepare('SELECT * FROM managed_users WHERE username = ?').get(username) as ManagedUserRow) ?? null;
}

/** Update managed user status */
export function updateManagedUserStatus(username: string, status: string): void {
  getDb().prepare(
    'UPDATE managed_users SET status = ?, updated_at = ? WHERE username = ?'
  ).run(status, nowUnix(), username);
}

/** Count active managed users (includes both active and disabled, matching Python logic) */
export function countActiveManagedUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) as cnt FROM managed_users WHERE status IN ('active', 'disabled')").get() as { cnt: number };
  return row.cnt;
}

/** Delete managed users with status 'deleted' older than retentionDays */
export function cleanupDeletedUsers(retentionDays: number): number {
  const cutoff = nowUnix() - retentionDays * 86400;
  const result = getDb().prepare(
    "DELETE FROM managed_users WHERE status = 'deleted' AND updated_at < ?"
  ).run(cutoff);
  return result.changes;
}
