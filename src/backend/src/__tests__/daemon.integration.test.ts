/**
 * Integration tests for daemon routes
 * Tests daemon token validation, localhost restriction, and status endpoint.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

// Set test env vars
vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
vi.stubEnv('DAEMON_TOKEN', 'test-daemon-token-123');
vi.stubEnv('JWT_SECRET', 'test-secret-key-for-daemon-tests');

// Mock system services
vi.mock('../services/system-user', () => ({
  createSystemUser: vi.fn().mockResolvedValue({ success: true }),
  updateSystemPassword: vi.fn().mockResolvedValue({ success: true }),
  deleteSystemUser: vi.fn().mockResolvedValue({ success: true }),
  enableSystemUser: vi.fn().mockResolvedValue({ success: true }),
  disableSystemUser: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../services/vscode-server', () => ({
  installVSCodeServer: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../services/ws-hub', () => ({
  broadcast: vi.fn(),
}));

let app: FastifyInstance;
let db: Database.Database;

function setupDb(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  database.exec(`
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

    CREATE TABLE agent_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_config_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      model_name TEXT NOT NULL,
      cpu_limit REAL NOT NULL DEFAULT 2.0,
      memory_limit TEXT NOT NULL DEFAULT '4G',
      pid INTEGER DEFAULT NULL,
      last_heartbeat TEXT DEFAULT NULL,
      error_count INTEGER NOT NULL DEFAULT 0,
      error_log TEXT DEFAULT NULL,
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

  return database;
}

describe('Daemon Integration Tests', () => {
  beforeAll(async () => {
    db = setupDb();

    // Seed users
    db.prepare("INSERT INTO users (username, role) VALUES ('testadmin', 'super_admin')").run();
    db.prepare("INSERT INTO users (username, role) VALUES ('devuser', 'programmer')").run();

    // Mock DB connection
    vi.doMock('../db/connection', () => ({
      getDb: () => db,
      closeDb: () => {},
      default: () => db,
    }));

    // Mock daemon service functions that need the DB
    vi.doMock('../services/daemon', () => ({
      getResourceUsage: vi.fn().mockReturnValue({
        cpuPercent: 15,
        memoryPercent: 45,
        memoryUsedMB: 4500,
        memoryTotalMB: 10000,
        diskPercent: 50,
      }),
      freezeAllAgents: vi.fn(),
      resumeAllAgents: vi.fn(),
    }));

    const { daemonRoutes } = await import('../routes/daemon');

    app = Fastify({
      trustProxy: true,
    });
    await app.register(daemonRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  describe('Daemon token authentication', () => {
    it('should return 401 when X-Daemon-Token is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/daemon/status',
        remoteAddress: '127.0.0.1',
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Daemon Token');
    });

    it('should return 401 when X-Daemon-Token is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/daemon/status',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept valid X-Daemon-Token from localhost', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/daemon/status',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
    });
  });

  describe('GET /api/v1/daemon/status', () => {
    it('should return system status with resource usage', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/daemon/status',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('resources');
      expect(body.data).toHaveProperty('agents');
      expect(body.data.resources).toHaveProperty('cpuPercent');
      expect(body.data.resources).toHaveProperty('memoryPercent');
      expect(body.data.agents).toHaveProperty('total');
    });
  });

  describe('POST /api/v1/daemon/auth/validate', () => {
    it('should validate existing active user credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/daemon/auth/validate',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: 'testadmin',
          password: 'anypassword',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.username).toBe('testadmin');
      expect(body.data.role).toBe('super_admin');
    });

    it('should return 401 for non-existent user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/daemon/auth/validate',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: 'nonexistent',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/daemon/auth/validate',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: '',
          password: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/daemon/users', () => {
    it('should create a new user via daemon API', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/daemon/users',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: 'newdaemonuser',
          password: 'password123',
          role: 'programmer',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.username).toBe('newdaemonuser');
    });

    it('should return 409 for duplicate username', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/daemon/users',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: 'testadmin',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('DELETE /api/v1/daemon/users', () => {
    it('should delete an existing user', async () => {
      // First create a user to delete
      db.prepare("INSERT INTO users (username, role) VALUES ('todelete', 'programmer')").run();

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/daemon/users',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: 'todelete',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);

      // Verify user is deleted from DB
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get('todelete');
      expect(user).toBeUndefined();
    });

    it('should return 404 for non-existent user', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/daemon/users',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-daemon-token': 'test-daemon-token-123',
        },
        payload: {
          username: 'nobody',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
