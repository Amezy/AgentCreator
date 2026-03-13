/**
 * 认证路由模块
 *
 * 管理用户登录认证和令牌刷新，提供以下端点：
 *   - POST /api/v1/auth/login   - 用户登录（PAM 认证 + JWT 签发）
 *   - POST /api/v1/auth/refresh - 刷新已有 JWT 令牌
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { generateToken, verifyToken, authMiddleware } from '../middleware/auth';
import { User, LoginBody, ApiResponse, JwtPayload, UserRole } from '../types';
import { pamAuthenticate } from '../services/pam-auth';
import { findDaemonAdmin } from '../services/daemon-db';
import { CONFIG } from '../services/config';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('Auth');

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/auth/login
   * Authenticate user via PAM and return JWT token.
   *
   * Login flow:
   * 1. Check daemon DB (managed_users) — admin accounts
   * 2. Check factory user env config — fallback super_admin
   * 3. Check box-system DB (users) — programmer accounts (rejected from management UI)
   */
  fastify.post<{ Body: LoginBody }>(
    '/api/v1/auth/login',
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { username, password } = request.body;

      if (!username || !password) {
        log.warn({ ip: request.ip }, 'Login attempt with missing credentials');
        return reply.code(400).send({
          success: false,
          error: '请输入用户名和密码',
        } as ApiResponse);
      }

      log.info({ username, ip: request.ip }, 'Login attempt');

      // --- Step 1: Check daemon managed_users (admin accounts) ---
      const daemonUser = findDaemonAdmin(username);
      if (daemonUser) {
        const pamValid = await pamAuthenticate(username, password);
        if (!pamValid) {
          log.warn({ username, ip: request.ip }, 'Login failed: invalid password (daemon admin)');
          return reply.code(401).send({
            success: false,
            error: '用户名或密码错误',
          } as ApiResponse);
        }

        const payload: JwtPayload = {
          userId: daemonUser.id,
          username: daemonUser.username,
          role: 'admin' as UserRole,
        };

        const token = generateToken(payload);
        log.info({ username, role: 'admin' }, 'Login successful (daemon admin)');

        return reply.code(200).send({
          success: true,
          data: {
            token,
            user: {
              id: daemonUser.id,
              username: daemonUser.username,
              role: 'admin',
              box_id: null,
            },
          },
        } as ApiResponse);
      }

      // --- Step 2: Factory user fallback (super_admin) ---
      // Accepts PAM auth or the configured FACTORY_PASSWORD (bootstrap password)
      if (username === CONFIG.FACTORY_USER) {
        const pamValid = await pamAuthenticate(username, password);
        const factoryPwValid = password === CONFIG.FACTORY_PASSWORD;
        if (!pamValid && !factoryPwValid) {
          log.warn({ username, ip: request.ip }, 'Login failed: invalid password (factory user)');
          return reply.code(401).send({
            success: false,
            error: '用户名或密码错误',
          } as ApiResponse);
        }

        const payload: JwtPayload = {
          userId: 0,
          username: CONFIG.FACTORY_USER,
          role: 'super_admin' as UserRole,
        };

        const token = generateToken(payload);
        log.info({ username, role: 'super_admin' }, 'Login successful (factory user)');

        return reply.code(200).send({
          success: true,
          data: {
            token,
            user: {
              id: 0,
              username: CONFIG.FACTORY_USER,
              role: 'super_admin',
              box_id: null,
            },
          },
        } as ApiResponse);
      }

      // --- Step 3: Check box-system DB (programmer accounts) ---
      const db = getDb();
      const localUser = db
        .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
        .get(username) as User | undefined;

      if (localUser) {
        log.warn({ username, ip: request.ip }, 'Login rejected: programmer account');
        return reply.code(403).send({
          success: false,
          error: '开发者账号无法登录管理系统',
        } as ApiResponse);
      }

      // User not found anywhere
      log.warn({ username, ip: request.ip }, 'Login failed: user not found');
      return reply.code(401).send({
        success: false,
        error: '用户名或密码错误',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/auth/refresh
   * Refresh an existing JWT token.
   */
  fastify.post(
    '/api/v1/auth/refresh',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;

      // Re-verify: admin from daemon DB, programmer from local DB
      if (user.role === 'super_admin' || user.role === 'admin') {
        // Admin/super_admin — just re-issue token
        const payload: JwtPayload = {
          userId: user.userId,
          username: user.username,
          role: user.role,
          boxId: user.boxId,
        };

        const token = generateToken(payload);

        return reply.code(200).send({
          success: true,
          data: {
            token,
            user: {
              id: user.userId,
              username: user.username,
              role: user.role,
              box_id: user.boxId || null,
            },
          },
        } as ApiResponse);
      }

      // Programmer — shouldn't have a valid token for management UI
      return reply.code(403).send({
        success: false,
        error: '开发者账号无法登录管理系统',
      } as ApiResponse);
    }
  );
}
