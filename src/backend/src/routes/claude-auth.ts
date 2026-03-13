/**
 * Claude Auth Routes
 *
 * Endpoints for managing Claude Code OAuth PKCE authentication.
 * All endpoints require JWT auth and admin-or-self authorization.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import {
  startSession,
  submitCode,
  getSessionStatus,
  cancelSession,
  getAuthStatus,
  logout,
} from '../services/claude-auth';
import { User, ApiResponse, SubmitCodeBody } from '../types';

/**
 * Check if the requesting user is admin-level or accessing their own resource.
 */
function checkAdminOrSelf(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: number
): boolean {
  const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
  if (!isAdmin && request.user!.userId !== userId) {
    reply.code(403).send({ success: false, error: '无权访问' } as ApiResponse);
    return false;
  }
  return true;
}

/**
 * Resolve user by ID from the database.
 */
function resolveUser(reply: FastifyReply, userId: number): User | null {
  if (isNaN(userId)) {
    reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
    return null;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user) {
    reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
    return null;
  }
  return user;
}

export async function claudeAuthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/users/:id/claude-auth/login/start
   * Start an OAuth PKCE session. Returns the OAuth URL for the admin to open.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/claude-auth/login/start',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      const user = resolveUser(reply, userId);
      if (!user) return;
      if (!checkAdminOrSelf(request, reply, userId)) return;

      const result = startSession(user.id, user.username);
      return reply.code(200).send({
        success: true,
        data: {
          session_id: result.sessionId,
          oauth_url: result.oauthUrl,
        },
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/users/:id/claude-auth/login/submit-code
   * Submit the authorization code from the OAuth callback.
   */
  fastify.post<{ Params: { id: string }; Body: SubmitCodeBody }>(
    '/api/v1/users/:id/claude-auth/login/submit-code',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      const user = resolveUser(reply, userId);
      if (!user) return;
      if (!checkAdminOrSelf(request, reply, userId)) return;

      const { code, session_id } = request.body;
      if (!code) {
        return reply.code(400).send({ success: false, error: '缺少授权码' } as ApiResponse);
      }

      // If session_id not provided, find the latest awaiting session for this user
      let targetSessionId = session_id;
      if (!targetSessionId) {
        const session = getSessionStatus(session_id || '');
        if (!session) {
          return reply.code(400).send({
            success: false,
            error: '缺少 session_id',
          } as ApiResponse);
        }
      }

      const result = await submitCode(targetSessionId!, code);
      if (!result.success) {
        return reply.code(400).send({ success: false, error: result.error } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        message: 'Claude 认证成功',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/users/:id/claude-auth/login/status
   * Get the status of an OAuth session.
   */
  fastify.get<{ Params: { id: string }; Querystring: { session_id?: string } }>(
    '/api/v1/users/:id/claude-auth/login/status',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }
      if (!checkAdminOrSelf(request, reply, userId)) return;

      const sessionId = (request.query as { session_id?: string }).session_id;
      if (!sessionId) {
        return reply.code(400).send({ success: false, error: '缺少 session_id' } as ApiResponse);
      }

      const session = getSessionStatus(sessionId);
      if (!session) {
        return reply.code(404).send({ success: false, error: '会话不存在' } as ApiResponse);
      }

      // Verify the session belongs to this user
      if (session.userId !== userId) {
        return reply.code(403).send({ success: false, error: '无权访问此会话' } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        data: {
          status: session.status,
          error: session.error,
          created_at: new Date(session.createdAt).toISOString(),
          expires_at: new Date(session.expiresAt).toISOString(),
        },
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/users/:id/claude-auth/login/cancel
   * Cancel an in-progress OAuth session.
   */
  fastify.post<{ Params: { id: string }; Body: { session_id?: string } }>(
    '/api/v1/users/:id/claude-auth/login/cancel',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }
      if (!checkAdminOrSelf(request, reply, userId)) return;

      const sessionId = request.body.session_id;
      if (!sessionId) {
        return reply.code(400).send({ success: false, error: '缺少 session_id' } as ApiResponse);
      }

      const session = getSessionStatus(sessionId);
      if (!session || session.userId !== userId) {
        return reply.code(404).send({ success: false, error: '会话不存在' } as ApiResponse);
      }

      cancelSession(sessionId);
      return reply.code(200).send({
        success: true,
        message: '会话已取消',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/users/:id/claude-auth/status
   * Check whether a user has valid Claude credentials on disk.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/users/:id/claude-auth/status',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      const user = resolveUser(reply, userId);
      if (!user) return;
      if (!checkAdminOrSelf(request, reply, userId)) return;

      const status = await getAuthStatus(user.username);
      return reply.code(200).send({ success: true, data: status } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/users/:id/claude-auth/logout
   * Remove Claude credentials for a user.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/claude-auth/logout',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userId = parseInt(request.params.id, 10);
      const user = resolveUser(reply, userId);
      if (!user) return;
      if (!checkAdminOrSelf(request, reply, userId)) return;

      const result = await logout(user.username);
      if (!result.success) {
        return reply.code(500).send({ success: false, error: result.error } as ApiResponse);
      }

      return reply.code(200).send({
        success: true,
        message: 'Claude 已登出',
      } as ApiResponse);
    }
  );
}
