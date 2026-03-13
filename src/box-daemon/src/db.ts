import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { PairedClient } from './types';

const GRACE_PERIOD_MS = 60_000;

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  if (db) return db;

  db = new Database(dbPath === ':memory:' ? ':memory:' : dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (let i = currentVersion; i < files.length; i++) {
    const sql = fs.readFileSync(path.join(migrationsDir, files[i]), 'utf-8');
    database.transaction(() => {
      database.exec(sql);
      database.pragma(`user_version = ${i + 1}`);
    })();
  }
}

// ── paired_clients CRUD ──

export function addPairedClient(params: { id: string; name: string; tokenHash: string }): void {
  getDb().prepare(
    'INSERT INTO paired_clients (id, name, token_hash, paired_at) VALUES (?, ?, ?, ?)'
  ).run(params.id, params.name, params.tokenHash, Date.now());
}

export function getPairedClient(id: string): PairedClient | null {
  return (getDb().prepare('SELECT * FROM paired_clients WHERE id = ?').get(id) as PairedClient) ?? null;
}

export function getPairedClientByTokenHash(tokenHash: string): PairedClient | null {
  return (getDb().prepare(
    `SELECT * FROM paired_clients
     WHERE (
       token_hash = ?
       OR (previous_token_hash = ? AND grace_expires_at > ?)
     )
     AND is_revoked = 0`
  ).get(tokenHash, tokenHash, Date.now()) as PairedClient) ?? null;
}

export function updateClientTokenHash(id: string, newHash: string): void {
  getDb().prepare(
    'UPDATE paired_clients SET token_hash = ?, previous_token_hash = NULL, grace_expires_at = NULL WHERE id = ?'
  ).run(newHash, id);
}

export function updateClientTokenHashWithGrace(id: string, newHash: string, oldHash: string): void {
  const graceExpires = Date.now() + GRACE_PERIOD_MS;
  getDb().prepare(
    'UPDATE paired_clients SET token_hash = ?, previous_token_hash = ?, grace_expires_at = ? WHERE id = ?'
  ).run(newHash, oldHash, graceExpires, id);
}

export function cleanExpiredGracePeriods(): void {
  getDb().prepare(
    'UPDATE paired_clients SET previous_token_hash = NULL, grace_expires_at = NULL WHERE grace_expires_at IS NOT NULL AND grace_expires_at < ?'
  ).run(Date.now());
}

export function updateClientLastSeen(id: string): void {
  getDb().prepare('UPDATE paired_clients SET last_seen = ? WHERE id = ?').run(Date.now(), id);
}

export function revokePairedClient(id: string): void {
  getDb().prepare('UPDATE paired_clients SET is_revoked = 1 WHERE id = ?').run(id);
}

export function listPairedClients(): PairedClient[] {
  return getDb().prepare('SELECT * FROM paired_clients WHERE is_revoked = 0 ORDER BY paired_at DESC').all() as PairedClient[];
}

// ── access_log ──

export function logAccess(params: {
  clientId: string; method: string; path: string;
  status: number; latencyMs: number; blockedBy?: string; createdAt?: number;
}): void {
  getDb().prepare(
    'INSERT INTO access_log (client_id, method, path, status, latency_ms, blocked_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(params.clientId, params.method, params.path, params.status, params.latencyMs, params.blockedBy ?? null, params.createdAt ?? Date.now());
}

// ── process_events ──

export function logProcessEvent(params: {
  process: string; event: string; exitCode?: number; signal?: string; message?: string;
}): void {
  getDb().prepare(
    'INSERT INTO process_events (process, event, exit_code, signal, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(params.process, params.event, params.exitCode ?? null, params.signal ?? null, params.message ?? null, Date.now());
}

// ── cleanup ──

export function cleanOldLogs(retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const r1 = getDb().prepare('DELETE FROM access_log WHERE created_at < ?').run(cutoff);
  const r2 = getDb().prepare('DELETE FROM process_events WHERE created_at < ?').run(cutoff);
  return r1.changes + r2.changes;
}
