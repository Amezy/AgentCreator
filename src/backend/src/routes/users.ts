/**
 * 用户管理路由模块
 *
 * 管理系统用户资源（含 Linux 系统用户同步），提供以下端点：
 *   - GET    /api/v1/users         - 列出所有用户（管理员）
 *   - POST   /api/v1/users         - 创建用户（管理员）
 *   - POST   /api/v1/users/ensure  - 确保用户存在（向导流程使用）
 *   - GET    /api/v1/users/:id     - 获取用户详情
 *   - PUT    /api/v1/users/:id     - 更新用户信息
 *   - DELETE /api/v1/users/:id     - 删除用户（级联清理）
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware, adminOnly } from '../middleware/auth';
import {
  User,
  UserPublic,
  CreateUserBody,
  UpdateUserBody,
  ApiResponse,
} from '../types';
import {
  createSystemUser,
  updateSystemPassword,
  deleteSystemUser,
  enableSystemUser,
  disableSystemUser,
  isUserOnline,
  systemUserExists,
} from '../services/system-user';
import { installVSCodeServer, getVSCodeServerStatus, getInstallProgress } from '../services/vscode-server';
import { pamAuthenticate } from '../services/pam-auth';
import { listDaemonAdmins, findDaemonAdminById } from '../services/daemon-db';
import { CONFIG } from '../services/config';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('Users');

/** Convert a User record to its public representation */
function toPublicUser(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    box_id: user.box_id,
    is_active: user.is_active,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/users
   * List all users. Admin only.
   * Merges admin accounts from daemon DB + programmer accounts from local DB.
   */
  fastify.get(
    '/api/v1/users',
    { preHandler: [authMiddleware, adminOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Admin users from daemon DB
      const daemonAdmins = listDaemonAdmins().map((u) => ({
        id: u.id,
        username: u.username,
        role: 'admin' as const,
        box_id: null,
        is_active: u.status === 'active' ? 1 : 0,
        created_at: new Date(u.created_at * 1000).toISOString(),
        updated_at: new Date(u.updated_at * 1000).toISOString(),
        source: 'daemon' as const,
      }));

      // Factory user (super_admin)
      const factoryUser = {
        id: 0,
        username: CONFIG.FACTORY_USER,
        role: 'super_admin' as const,
        box_id: null,
        is_active: 1,
        created_at: '',
        updated_at: '',
        source: 'factory' as const,
      };

      // Programmer accounts from local DB
      const db = getDb();
      const programmers = (db.prepare('SELECT * FROM users ORDER BY id ASC').all() as User[]).map((u) => ({
        ...toPublicUser(u),
        source: 'local' as const,
      }));

      return reply.code(200).send({
        success: true,
        data: [factoryUser, ...daemonAdmins, ...programmers],
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/users
   * Create a new user. Admin only.
   * Creates both a DB record and a Linux system user.
   */
  fastify.post<{ Body: CreateUserBody }>(
    '/api/v1/users',
    { preHandler: [authMiddleware, adminOnly] },
    async (
      request: FastifyRequest<{ Body: CreateUserBody }>,
      reply: FastifyReply
    ) => {
      const { username, password, role } = request.body;

      if (!username || !password) {
        return reply.code(400).send({
          success: false,
          error: '请输入用户名和密码',
        } as ApiResponse);
      }

      if (username.length < 3 || username.length > 50) {
        return reply.code(400).send({
          success: false,
          error: '用户名长度需在 3-50 个字符之间',
        } as ApiResponse);
      }

      if (password.length < 6) {
        return reply.code(400).send({
          success: false,
          error: '密码至少 6 个字符',
        } as ApiResponse);
      }

      // Box-system only manages programmer accounts; admin accounts are created via daemon
      const userRole = 'programmer';

      const db = getDb();

      // Check for duplicate username
      const existing = db
        .prepare('SELECT id FROM users WHERE username = ?')
        .get(username);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: '用户名已存在',
        } as ApiResponse);
      }

      // DB INSERT (no password_hash)
      const result = db
        .prepare('INSERT INTO users (username, role) VALUES (?, ?)')
        .run(username, userRole);

      // Create Linux system user
      const sysResult = await createSystemUser(username, password, userRole);
      if (!sysResult.success) {
        // Rollback DB insert
        db.prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);
        log.error({ username, error: sysResult.error }, 'System user creation failed');
        return reply.code(500).send({
          success: false,
          error: `系统用户创建失败: ${sysResult.error}`,
        } as ApiResponse);
      }

      log.info({ username, role: userRole }, 'User created successfully');

      // Install VS Code Server for programmers (fire-and-forget)
      if (userRole === 'programmer' && CONFIG.VSCODE_ENABLED) {
        installVSCodeServer(username).then((r) => {
          if (!r.success) {
            log.error({ username, error: r.error }, 'VS Code install failed');
          } else {
            log.info({ username }, 'VS Code install completed');
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
        data: toPublicUser(newUser),
        message: '用户创建成功',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/users/ensure
   * Create user if not exists; verify password if exists.
   * Used by wizard to ensure user exists before proceeding to model config.
   */
  fastify.post<{ Body: CreateUserBody }>(
    '/api/v1/users/ensure',
    { preHandler: [authMiddleware, adminOnly] },
    async (
      request: FastifyRequest<{ Body: CreateUserBody }>,
      reply: FastifyReply
    ) => {
      const { username, password } = request.body;

      if (!username || !password) {
        return reply.code(400).send({
          success: false,
          error: '请输入用户名和密码',
        } as ApiResponse);
      }

      if (username.length < 3 || username.length > 50) {
        return reply.code(400).send({
          success: false,
          error: '用户名长度需在 3-50 个字符之间',
        } as ApiResponse);
      }

      if (password.length < 6) {
        return reply.code(400).send({
          success: false,
          error: '密码至少 6 个字符',
        } as ApiResponse);
      }

      const db = getDb();
      const existing = db
        .prepare('SELECT * FROM users WHERE username = ?')
        .get(username) as User | undefined;

      if (existing) {
        // User exists — verify password via PAM
        const pamValid = await pamAuthenticate(username, password);
        if (!pamValid) {
          return reply.code(409).send({
            success: false,
            error: '用户已存在，密码不正确',
          } as ApiResponse);
        }

        // Determine VS Code installation status
        let vscodeStatus: 'installed' | 'installing' | 'not_installed' = 'not_installed';
        if (CONFIG.VSCODE_ENABLED && existing.role === 'programmer') {
          // Check if an install is already in progress
          const progress = getInstallProgress(username);
          if (progress?.status === 'installing') {
            vscodeStatus = 'installing';
          } else {
            const status = await getVSCodeServerStatus(username);
            if (status.installed) {
              vscodeStatus = 'installed';
            } else {
              log.info({ username }, 'VS Code not installed for existing user, triggering install');
              vscodeStatus = 'installing';
              installVSCodeServer(username).then((r) => {
                if (!r.success) {
                  log.error({ username, error: r.error }, 'VS Code install failed (ensure/existing)');
                }
              }).catch((err) => {
                log.error({ username, err }, 'VS Code install error (ensure/existing)');
              });
            }
          }
        }

        return reply.code(200).send({
          success: true,
          data: { ...toPublicUser(existing), vscode_status: vscodeStatus },
          message: '用户已存在，密码验证通过',
        } as ApiResponse);
      }

      // User does not exist — create
      const result = db
        .prepare('INSERT INTO users (username, role) VALUES (?, ?)')
        .run(username, 'programmer');

      const sysResult = await createSystemUser(username, password, 'programmer');
      if (!sysResult.success) {
        db.prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);
        log.error({ username, error: sysResult.error }, 'System user creation failed (ensure)');
        return reply.code(500).send({
          success: false,
          error: `系统用户创建失败: ${sysResult.error}`,
        } as ApiResponse);
      }

      log.info({ username }, 'User ensured (created)');

      let vscodeStatus: 'installed' | 'installing' | 'not_installed' = 'not_installed';
      if (CONFIG.VSCODE_ENABLED) {
        vscodeStatus = 'installing';
        installVSCodeServer(username).then((r) => {
          if (!r.success) {
            log.error({ username, error: r.error }, 'VS Code install failed (ensure)');
          }
        }).catch((err) => {
          log.error({ username, err }, 'VS Code install error (ensure)');
        });
      }

      const newUser = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(result.lastInsertRowid) as User;

      return reply.code(201).send({
        success: true,
        data: { ...toPublicUser(newUser), vscode_status: vscodeStatus },
        message: '用户创建成功',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/users/:id
   * Get user details. Authenticated users can view their own profile;
   * admins can view any user.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/users/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的用户 ID',
        } as ApiResponse);
      }

      // Non-admin users can only view their own profile
      if (request.user!.role === 'programmer' && request.user!.userId !== userId) {
        return reply.code(403).send({
          success: false,
          error: '无权访问',
        } as ApiResponse);
      }

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as User | undefined;

      if (!user) {
        return reply.code(404).send({
          success: false,
          error: '用户不存在',
        } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        data: toPublicUser(user),
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/users/:id
   * Update user. Users can update their own profile (username, password);
   * admins can update any user including role and is_active.
   */
  fastify.put<{ Params: { id: string }; Body: UpdateUserBody }>(
    '/api/v1/users/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateUserBody }>,
      reply: FastifyReply
    ) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的用户 ID',
        } as ApiResponse);
      }

      const isAdminLevel = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const isSelf = request.user!.userId === userId;

      if (!isAdminLevel && !isSelf) {
        return reply.code(403).send({
          success: false,
          error: '无权操作',
        } as ApiResponse);
      }

      const db = getDb();
      const existingUser = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as User | undefined;

      if (!existingUser) {
        return reply.code(404).send({
          success: false,
          error: '用户不存在',
        } as ApiResponse);
      }

      const { username, password, role, is_active } = request.body;
      const updates: string[] = [];
      const values: (string | number)[] = [];

      if (username !== undefined) {
        if (username.length < 3 || username.length > 50) {
          return reply.code(400).send({
            success: false,
            error: '用户名长度需在 3-50 个字符之间',
          } as ApiResponse);
        }
        // Check for duplicate
        const dup = db
          .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
          .get(username, userId);
        if (dup) {
          return reply.code(409).send({
            success: false,
            error: '用户名已存在',
          } as ApiResponse);
        }
        updates.push('username = ?');
        values.push(username);
      }

      // Password update via system user service
      if (password !== undefined) {
        if (password.length < 6) {
          return reply.code(400).send({
            success: false,
            error: '密码至少 6 个字符',
          } as ApiResponse);
        }
        const pwResult = await updateSystemPassword(existingUser.username, password);
        if (!pwResult.success) {
          return reply.code(500).send({
            success: false,
            error: `密码更新失败: ${pwResult.error}`,
          } as ApiResponse);
        }
      }

      // Role changes are not allowed — admin accounts are managed by daemon
      if (role !== undefined) {
        return reply.code(400).send({
          success: false,
          error: '角色变更不支持，管理员账号由守护服务管理',
        } as ApiResponse);
      }

      if (is_active !== undefined) {
        if (!isAdminLevel) {
          return reply.code(403).send({
            success: false,
            error: '仅管理员可修改用户状态',
          } as ApiResponse);
        }
        updates.push('is_active = ?');
        values.push(is_active);

        // Sync with system user
        if (is_active === 1) {
          await enableSystemUser(existingUser.username);
        } else {
          await disableSystemUser(existingUser.username);
        }
      }

      // If only password was changed with no DB field updates, still update updated_at
      if (updates.length === 0 && password === undefined) {
        return reply.code(400).send({
          success: false,
          error: '没有需要更新的字段',
        } as ApiResponse);
      }

      if (updates.length > 0 || password !== undefined) {
        updates.push("updated_at = datetime('now')");
        values.push(userId);
        db.prepare(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
        ).run(...values);
      }

      const updatedUser = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as User;

      return reply.code(200).send({
        success: true,
        data: toPublicUser(updatedUser),
        message: '用户更新成功',
      } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/users/:id
   * Delete a user. Admin only.
   * Deletes both the system user and DB record.
   */
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/api/v1/users/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { force?: string } }>,
      reply: FastifyReply
    ) => {
      const userId = parseInt(request.params.id, 10);
      const forceDelete = request.query.force === 'true';
      if (isNaN(userId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的用户 ID',
        } as ApiResponse);
      }

      // Prevent self-deletion
      if (request.user!.userId === userId) {
        return reply.code(400).send({
          success: false,
          error: '不能删除自己的账号',
        } as ApiResponse);
      }

      const db = getDb();
      const localUser = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as User | undefined;

      // Also check daemon DB for admin accounts (e.g. aiboxadmin)
      const daemonAdmin = !localUser ? findDaemonAdminById(userId) : null;

      if (!localUser && !daemonAdmin) {
        return reply.code(404).send({
          success: false,
          error: '用户不存在',
        } as ApiResponse);
      }

      // Determine username and role from whichever source found the user
      const username = localUser ? localUser.username : daemonAdmin!.username;
      const userRole = localUser ? localUser.role : 'admin';
      const isDaemonAdmin = !localUser && !!daemonAdmin;

      log.info({ userId, username, role: userRole, source: isDaemonAdmin ? 'daemon' : 'local' }, 'Deleting user');

      // Check if user is currently online (has active login sessions)
      const online = await isUserOnline(username);
      if (online && !forceDelete) {
        log.warn({ userId, username }, 'Cannot delete: user is online');
        return reply.code(409).send({
          success: false,
          error: `用户 ${username} 当前在线，请等待用户下线后再删除`,
          online: true,
        } as ApiResponse);
      }
      if (online && forceDelete) {
        log.info({ userId, username }, 'Force deleting online user');
      }

      // For local DB users: cascade-delete all associated records
      if (localUser) {
        const deleteAllUserData = db.transaction((uid: number) => {
          const teamRows = db
            .prepare('SELECT id FROM team_configs WHERE user_id = ?')
            .all(uid) as { id: number }[];
          const teamIds = teamRows.map((r) => r.id);

          if (teamIds.length > 0) {
            const placeholders = teamIds.map(() => '?').join(',');
            const agentRows = db
              .prepare(`SELECT id FROM agent_instances WHERE team_config_id IN (${placeholders})`)
              .all(...teamIds) as { id: number }[];
            const agentIds = agentRows.map((r) => r.id);

            if (agentIds.length > 0) {
              const agentPlaceholders = agentIds.map(() => '?').join(',');
              db.prepare(`DELETE FROM agent_superpowers WHERE agent_instance_id IN (${agentPlaceholders})`)
                .run(...agentIds);
              db.prepare(`UPDATE system_events SET agent_id = NULL WHERE agent_id IN (${agentPlaceholders})`)
                .run(...agentIds);
            }

            db.prepare(`DELETE FROM agent_instances WHERE team_config_id IN (${placeholders})`)
              .run(...teamIds);
          }

          db.prepare('DELETE FROM team_configs WHERE user_id = ?').run(uid);
          db.prepare('DELETE FROM model_credentials WHERE user_id = ?').run(uid);
          db.prepare('DELETE FROM deployment_configs WHERE user_id = ?').run(uid);
          db.prepare('DELETE FROM git_repositories WHERE user_id = ?').run(uid);
          db.prepare('DELETE FROM user_ssh_keys WHERE user_id = ?').run(uid);
          db.prepare('DELETE FROM users WHERE id = ?').run(uid);
        });

        try {
          deleteAllUserData(userId);
          log.info({ userId, username }, 'User DB records deleted');
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error({ userId, username, err }, 'User data cleanup failed');
          return reply.code(500).send({
            success: false,
            error: `用户数据清理失败: ${errorMessage}`,
          } as ApiResponse);
        }
      }

      // Delete the OS system user (skip if user doesn't exist on OS)
      const exists = await systemUserExists(username);
      if (exists) {
        const sysResult = await deleteSystemUser(username);
        if (!sysResult.success) {
          // OS deletion failed — rollback DB for local users
          if (localUser) {
            log.error({ userId, username, error: sysResult.error }, 'Failed to delete system user, rolling back DB');
            try {
              db.prepare(
                'INSERT INTO users (id, username, role, box_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
              ).run(localUser.id, localUser.username, localUser.role, localUser.box_id, localUser.is_active, localUser.created_at, localUser.updated_at);
            } catch (rollbackErr) {
              log.error({ userId, username, rollbackErr }, 'DB rollback also failed — manual intervention needed');
            }
          }
          return reply.code(500).send({
            success: false,
            error: `系统用户删除失败: ${sysResult.error}`,
          } as ApiResponse);
        }
        log.info({ userId, username }, 'System user deleted');
      } else {
        log.info({ userId, username }, 'OS user does not exist, skipping system user deletion');
      }

      log.info({ userId, username }, 'User deleted successfully');
      return reply.code(200).send({
        success: true,
        message: '用户删除成功',
      } as ApiResponse);
    }
  );
}
