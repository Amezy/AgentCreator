/**
 * Tests for migrate.ts - Database Migration System
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate';

// Suppress console.log during migrations
vi.spyOn(console, 'log').mockImplementation(() => {});

function createNewSchemaDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'programmer',
      box_id TEXT DEFAULT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE model_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      api_key_enc TEXT DEFAULT ''
    );
    CREATE TABLE agent_superpowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_instance_id INTEGER NOT NULL
    );
    CREATE TABLE system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      agent_id INTEGER DEFAULT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL
    );
  `);
  return db;
}

function createOldSchemaDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'programmer',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_users_username ON users(username);
    CREATE TABLE model_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      api_key_enc TEXT DEFAULT ''
    );
    CREATE TABLE agent_superpowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_instance_id INTEGER NOT NULL
    );
    CREATE TABLE system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      agent_id INTEGER DEFAULT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL
    );
  `);
  return db;
}

describe('runMigrations', () => {
  describe('new database initialization', () => {
    it('should create _migrations table', () => {
      const db = createNewSchemaDb();
      runMigrations(db);

      const migrations = db.prepare('SELECT id FROM _migrations').all() as { id: string }[];
      expect(migrations.length).toBe(1);
      expect(migrations[0].id).toBe('001-pam-migration');
      db.close();
    });

    it('should create user_ssh_keys table', () => {
      const db = createNewSchemaDb();
      runMigrations(db);

      const tableInfo = db.pragma('table_info(user_ssh_keys)') as { name: string }[];
      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('key_type');
      expect(columnNames).toContain('public_key');
      expect(columnNames).toContain('fingerprint');
      expect(columnNames).toContain('comment');
      db.close();
    });

    it('should not re-apply already applied migrations', () => {
      const db = createNewSchemaDb();
      runMigrations(db);
      // Run again - should not throw
      runMigrations(db);

      const migrations = db.prepare('SELECT id FROM _migrations').all() as { id: string }[];
      expect(migrations.length).toBe(1);
      db.close();
    });
  });

  describe('migration from old schema (with password_hash)', () => {
    it('should remove password_hash column from users table', () => {
      const db = createOldSchemaDb();

      // Insert a user with old schema
      db.prepare(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')"
      ).run('olduser', 'hashed-password');

      runMigrations(db);

      // Check password_hash column is gone
      const tableInfo = db.pragma('table_info(users)') as { name: string }[];
      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).not.toContain('password_hash');
      expect(columnNames).toContain('box_id');

      // Check data is preserved
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get('olduser') as {
        username: string;
        role: string;
      };
      expect(user.username).toBe('olduser');
      expect(user.role).toBe('admin');
      db.close();
    });

    it('should add box_id column during migration', () => {
      const db = createOldSchemaDb();
      runMigrations(db);

      const tableInfo = db.pragma('table_info(users)') as { name: string }[];
      const columnNames = tableInfo.map((col) => col.name);
      expect(columnNames).toContain('box_id');
      db.close();
    });
  });
});
