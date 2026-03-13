/**
 * Integration tests for auth routes
 * Uses Fastify inject to test login, token refresh, etc.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

// Set dev mode before anything imports config
vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
vi.stubEnv('JWT_SECRET', 'test-secret-key-for-integration');

// Mock system-user service to no-op
vi.mock('../services/system-user', () => ({
  createSystemUser: vi.fn().mockResolvedValue({ success: true }),
  updateSystemPassword: vi.fn().mockResolvedValue({ success: true }),
  deleteSystemUser: vi.fn().mockResolvedValue({ success: true }),
  enableSystemUser: vi.fn().mockResolvedValue({ success: true }),
  disableSystemUser: vi.fn().mockResolvedValue({ success: true }),
  deploySSHKey: vi.fn().mockResolvedValue({ success: true }),
  removeSSHKey: vi.fn().mockResolvedValue({ success: true }),
  systemUserExists: vi.fn().mockResolvedValue(true),
}));

// Mock vscode-server service
vi.mock('../services/vscode-server', () => ({
  installVSCodeServer: vi.fn().mockResolvedValue({ success: true }),
  getVSCodeServerStatus: vi.fn().mockResolvedValue({ installed: false }),
}));

// Mock daemon service
vi.mock('../services/daemon', () => ({
  getResourceUsage: vi.fn().mockReturnValue({
    cpuPercent: 10,
    memoryPercent: 40,
    memoryUsedMB: 4000,
    memoryTotalMB: 10000,
    diskPercent: 50,
  }),
  freezeAllAgents: vi.fn(),
  resumeAllAgents: vi.fn(),
}));

// Mock ws-hub
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
    CREATE INDEX idx_ssh_keys_user ON user_ssh_keys(user_id);
    CREATE UNIQUE INDEX idx_ssh_keys_fingerprint ON user_ssh_keys(fingerprint);

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

describe('Auth Integration Tests', () => {
  beforeAll(async () => {
    db = setupDb();

    // Seed admin user
    db.prepare("INSERT INTO users (username, role) VALUES ('testadmin', 'super_admin')").run();
    // Seed programmer user
    db.prepare("INSERT INTO users (username, role) VALUES ('testprogrammer', 'programmer')").run();

    // Mock the DB connection module
    vi.doMock('../db/connection', () => ({
      getDb: () => db,
      closeDb: () => {},
      default: () => db,
    }));

    // Import routes after mocking
    const { authRoutes } = await import('../routes/auth');

    app = Fastify();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully with valid admin credentials (dev mode)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testadmin',
          password: 'anypassword',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('token');
      expect(body.data.user.username).toBe('testadmin');
      expect(body.data.user.role).toBe('super_admin');
    });

    it('should return 401 for non-existent user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'nonexistent',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('用户名或密码错误');
    });

    it('should return 400 for missing username', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: '',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it('should return 400 for missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testadmin',
          password: '',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it('should return 403 for programmer accounts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testprogrammer',
          password: 'anypassword',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('开发者账号无法登录管理系统');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh a valid token', async () => {
      // First login to get a token
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testadmin',
          password: 'anypassword',
        },
      });

      const { token } = loginResponse.json().data;

      // Refresh the token
      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(refreshResponse.statusCode).toBe(200);
      const body = refreshResponse.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('token');
      expect(body.data.user.username).toBe('testadmin');
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          authorization: 'Bearer invalid-token-here',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
