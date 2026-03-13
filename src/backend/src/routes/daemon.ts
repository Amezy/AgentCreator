/**
 * Daemon API Routes
 *
 * Internal endpoints for the cloud service daemon to manage users,
 * validate authentication, and control agents. All endpoints are
 * authenticated via X-Daemon-Token and restricted to localhost.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { daemonAuthMiddleware } from '../middleware/auth';
import { pamAuthenticate } from '../services/pam-auth';
import {
  createSystemUser,
  updateSystemPassword,
  deleteSystemUser,
  enableSystemUser,
  disableSystemUser,
  isUserOnline,
} from '../services/system-user';
import { installVSCodeServer } from '../services/vscode-server';
import { getResourceUsage, freezeAllAgents, resumeAllAgents } from '../services/daemon';
import { CONFIG } from '../services/config';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('DaemonRoute');
import {
  User,
  ApiResponse,
  DaemonAuthValidateBody,
  DaemonCreateUserBody,
  DaemonUpdatePasswordBody,
  DaemonDeleteUserBody,
  DaemonUserToggleBody,
} from '../types';

export async function daemonRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/daemon/auth/validate
   * Validate user credentials via DB lookup + PAM authentication.
   */
  fastify.post<{ Body: DaemonAuthValidateBody }>(
    '/api/v1/daemon/auth/validate',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: DaemonAuthValidateBody }>, reply: FastifyReply) => {
      const { username, password } = request.body;

      if (!username || !password) {
        return reply.code(400).send({
          success: false,
          error: '缺少用户名或密码',
        } as ApiResponse);
      }

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
        .get(username) as User | undefined;

      if (!user) {
        return reply.code(401).send({
          success: false,
          error: '用户不存在或已禁用',
        } as ApiResponse);
      }

      const pamValid = await pamAuthenticate(username, password);
      if (!pamValid) {
        return reply.code(401).send({
          success: false,
          error: '密码验证失败',
        } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          role: user.role,
          box_id: user.box_id,
        },
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/daemon/users
   * Create a new user: DB record + Linux system user + VS Code Server.
   */
  fastify.post<{ Body: DaemonCreateUserBody }>(
    '/api/v1/daemon/users',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: DaemonCreateUserBody }>, reply: FastifyReply) => {
      const { username, password, role } = request.body;
      const userRole = role || 'programmer';

      if (!username || !password) {
        return reply.code(400).send({
          success: false,
          error: '缺少用户名或密码',
        } as ApiResponse);
      }

      const db = getDb();

      // Check duplicate
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: '用户名已存在',
        } as ApiResponse);
      }

      // DB INSERT
      const result = db
        .prepare('INSERT INTO users (username, role) VALUES (?, ?)')
        .run(username, userRole);

      // Create system user
      const sysResult = await createSystemUser(username, password, userRole);
      if (!sysResult.success) {
        // Rollback DB
        db.prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);
        return reply.code(500).send({
          success: false,
          error: `系统用户创建失败: ${sysResult.error}`,
        } as ApiResponse);
      }

      log.info({ username, role: userRole }, 'Daemon created user');

      // Install VS Code Server for programmers (fire-and-forget)
      if (userRole === 'programmer' && CONFIG.VSCODE_ENABLED) {
        installVSCodeServer(username).then((r) => {
          if (!r.success) {
            log.error({ username, error: r.error }, 'VS Code install failed');
          }
        }).catch((err) => {
          log.error({ username, err }, 'VS Code install error');
        });
      }

      const newUser = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(result.lastInsertRowid) as User;

      return reply.code(201).send({
        success: true,
        data: {
          id: newUser.id,
          username: newUser.username,
          role: newUser.role,
        },
        message: '用户创建成功',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/daemon/users
   * Update a user's system password.
   */
  fastify.put<{ Body: DaemonUpdatePasswordBody }>(
    '/api/v1/daemon/users',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: DaemonUpdatePasswordBody }>, reply: FastifyReply) => {
      const { username, password } = request.body;

      if (!username || !password) {
        return reply.code(400).send({
          success: false,
          error: '缺少用户名或密码',
        } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as User | undefined;
      if (!user) {
        return reply.code(404).send({
          success: false,
          error: '用户不存在',
        } as ApiResponse);
      }

      const result = await updateSystemPassword(username, password);
      if (!result.success) {
        return reply.code(500).send({
          success: false,
          error: `密码更新失败: ${result.error}`,
        } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        message: '密码更新成功',
      } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/daemon/users
   * Delete a user: system user + DB record (cascade).
   */
  fastify.delete<{ Body: DaemonDeleteUserBody }>(
    '/api/v1/daemon/users',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: DaemonDeleteUserBody }>, reply: FastifyReply) => {
      const { username } = request.body;

      if (!username) {
        return reply.code(400).send({
          success: false,
          error: '缺少用户名',
        } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
      if (!user) {
        return reply.code(404).send({
          success: false,
          error: '用户不存在',
        } as ApiResponse);
      }

      // Check if user is online
      const online = await isUserOnline(username);
      if (online) {
        return reply.code(409).send({
          success: false,
          error: `用户 ${username} 当前在线，请等待用户下线后再删除`,
        } as ApiResponse);
      }

      // Delete from DB first
      db.prepare('DELETE FROM users WHERE username = ?').run(username);

      // Then delete OS system user
      const sysResult = await deleteSystemUser(username);
      if (!sysResult.success) {
        // OS deletion failed — rollback DB
        try {
          db.prepare(
            'INSERT INTO users (id, username, role, box_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(user.id, user.username, user.role, user.box_id, user.is_active, user.created_at, user.updated_at);
        } catch {
          // Rollback also failed — inconsistent state, needs manual fix
        }
        return reply.code(500).send({
          success: false,
          error: `系统用户删除失败: ${sysResult.error}，数据库已回滚`,
        } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        message: '用户删除成功',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/daemon/users/enable
   * Enable a user: set is_active=1 + unlock system account.
   */
  fastify.put<{ Body: DaemonUserToggleBody }>(
    '/api/v1/daemon/users/enable',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: DaemonUserToggleBody }>, reply: FastifyReply) => {
      const { username } = request.body;

      if (!username) {
        return reply.code(400).send({ success: false, error: '缺少用户名' } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as User | undefined;
      if (!user) {
        return reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      db.prepare("UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE username = ?").run(username);

      const result = await enableSystemUser(username);
      if (!result.success) {
        return reply.code(500).send({
          success: false,
          error: `启用用户失败: ${result.error}`,
        } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        message: '用户已启用',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/daemon/users/disable
   * Disable a user: set is_active=0 + lock system account.
   */
  fastify.put<{ Body: DaemonUserToggleBody }>(
    '/api/v1/daemon/users/disable',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: DaemonUserToggleBody }>, reply: FastifyReply) => {
      const { username } = request.body;

      if (!username) {
        return reply.code(400).send({ success: false, error: '缺少用户名' } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as User | undefined;
      if (!user) {
        return reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      db.prepare("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE username = ?").run(username);

      const result = await disableSystemUser(username);
      if (!result.success) {
        return reply.code(500).send({
          success: false,
          error: `禁用用户失败: ${result.error}`,
        } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        message: '用户已禁用',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/daemon/status
   * Get system resource usage and agent counts.
   */
  fastify.get(
    '/api/v1/daemon/status',
    { preHandler: [daemonAuthMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const db = getDb();
      const resources = getResourceUsage();

      const agentCounts = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM agent_instances
        GROUP BY status
      `).all() as { status: string; count: number }[];

      const totalAgents = agentCounts.reduce((sum, r) => sum + r.count, 0);

      return reply.code(200).send({
        success: true,
        data: {
          resources,
          agents: {
            total: totalAgents,
            by_status: Object.fromEntries(agentCounts.map((r) => [r.status, r.count])),
          },
        },
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/daemon/agents/freeze
   * Freeze (suspend) all active agents.
   */
  fastify.post<{ Body: { reason?: string } }>(
    '/api/v1/daemon/agents/freeze',
    { preHandler: [daemonAuthMiddleware] },
    async (request: FastifyRequest<{ Body: { reason?: string } }>, reply: FastifyReply) => {
      const reason = request.body.reason || 'Daemon freeze request';
      freezeAllAgents(reason);

      return reply.code(200).send({
        success: true,
        message: '所有 Agent 已冻结',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/daemon/agents/resume
   * Resume all suspended agents.
   */
  fastify.post(
    '/api/v1/daemon/agents/resume',
    { preHandler: [daemonAuthMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      resumeAllAgents();

      return reply.code(200).send({
        success: true,
        message: '所有 Agent 已恢复',
      } as ApiResponse);
    }
  );
}
