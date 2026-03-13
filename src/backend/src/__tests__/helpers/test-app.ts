/**
 * Test helper: creates a Fastify app with an in-memory SQLite database
 * for integration testing.
 */
import Fastify, { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let testDb: Database.Database | null = null;

/**
 * Initialize an in-memory database with the application schema.
 */
export function initTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Read and execute schema
  const schemaPath = path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql');
  let schemaSql: string;

  // Try multiple possible paths
  const possiblePaths = [
    path.join(__dirname, '..', 'db', 'schema.sql'),
    path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql'),
  ];

  let found = false;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      schemaSql = fs.readFileSync(p, 'utf-8');
      const statements = schemaSql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('PRAGMA'));
      for (const statement of statements) {
        db.exec(statement + ';');
      }
      found = true;
      break;
    }
  }

  if (!found) {
    // Inline minimal schema for testing
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'programmer' CHECK(role IN ('super_admin', 'admin', 'programmer')),
        box_id TEXT DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_users_username ON users(username);

      CREATE TABLE user_ssh_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key_type TEXT NOT NULL DEFAULT 'ssh-rsa',
        public_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        comment TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE agent_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_config_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        model_name TEXT NOT NULL,
        cpu_limit REAL NOT NULL DEFAULT 2.0,
        memory_limit TEXT NOT NULL DEFAULT '4G',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        agent_id INTEGER DEFAULT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        metadata_json TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  testDb = db;
  return db;
}

/**
 * Seed a test admin user into the database.
 */
export function seedAdminUser(db: Database.Database): { id: number; username: string } {
  const result = db
    .prepare("INSERT INTO users (username, role) VALUES ('testadmin', 'super_admin')")
    .run();
  return { id: Number(result.lastInsertRowid), username: 'testadmin' };
}

/**
 * Seed a test programmer user into the database.
 */
export function seedProgrammerUser(db: Database.Database): { id: number; username: string } {
  const result = db
    .prepare("INSERT INTO users (username, role) VALUES ('testprogrammer', 'programmer')")
    .run();
  return { id: Number(result.lastInsertRowid), username: 'testprogrammer' };
}

export function getTestDb(): Database.Database | null {
  return testDb;
}

export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}
