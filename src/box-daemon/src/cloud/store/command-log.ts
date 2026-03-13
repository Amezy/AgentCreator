import { getDb } from '../../db';
import { nowUnix } from '../types';

export interface CommandLogRow {
  cmd_id: string;
  cmd_type: string;
  status: string;
  request: string;
  response: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** Insert a new command log entry */
export function insertCommandLog(cmdId: string, cmdType: string, request: Record<string, unknown>): void {
  const now = nowUnix();
  getDb().prepare(
    'INSERT OR IGNORE INTO command_log (cmd_id, cmd_type, status, request, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(cmdId, cmdType, 'pending', JSON.stringify(request), now, now);
}

/** Get a command log entry by cmd_id */
export function getCommandLog(cmdId: string): CommandLogRow | null {
  return (getDb().prepare('SELECT * FROM command_log WHERE cmd_id = ?').get(cmdId) as CommandLogRow) ?? null;
}

/** Update command status and optional response/error */
export function updateCommandStatus(
  cmdId: string,
  status: string,
  response?: Record<string, unknown>,
  error?: string,
): void {
  getDb().prepare(
    'UPDATE command_log SET status = ?, response = ?, error = ?, updated_at = ? WHERE cmd_id = ?'
  ).run(status, response ? JSON.stringify(response) : null, error ?? null, nowUnix(), cmdId);
}

/** Delete command logs older than retentionDays */
export function cleanupOldCommands(retentionDays: number): number {
  const cutoff = nowUnix() - retentionDays * 86400;
  const result = getDb().prepare('DELETE FROM command_log WHERE created_at < ?').run(cutoff);
  return result.changes;
}
