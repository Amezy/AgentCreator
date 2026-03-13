/**
 * VS Code Server Routes
 *
 * Endpoints to manage VS Code Server installation for programmer users.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { reinstallVSCodeServer, getVSCodeServerStatus, getInstallProgress } from '../services/vscode-server';
import { User, ApiResponse } from '../types';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('VSCodeRoute');

export async function vscodeRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/users/:id/vscode-server/reinstall
   * Trigger VS Code Server reinstallation for a programmer user. Admin only.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/vscode-server/reinstall',
    { preHandler: [authMiddleware, adminOnly] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;

      if (!user) {
        return reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      if (user.role !== 'programmer') {
        return reply.code(400).send({
          success: false,
          error: '仅 programmer 用户需要 VS Code Server',
        } as ApiResponse);
      }

      // Fire async reinstall (force mode), respond immediately
      log.info({ username: user.username }, 'Triggering VS Code Server reinstall');
      reinstallVSCodeServer(user.username).then((result) => {
        if (!result.success) {
          log.error({ username: user.username, error: result.error }, 'Reinstall failed');
        } else {
          log.info({ username: user.username }, 'Reinstall completed');
        }
      }).catch((err) => {
        log.error({ username: user.username, err }, 'Reinstall unexpected error');
      });

      return reply.code(200).send({
        success: true,
        message: 'VS Code Server 重新安装已启动',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/users/:id/vscode-server/status
   * Check VS Code Server installation status. Admin or self.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/users/:id/vscode-server/status',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }

      // Admin or self
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      if (!isAdmin && request.user!.userId !== userId) {
        return reply.code(403).send({ success: false, error: '无权访问' } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;

      if (!user) {
        return reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      const status = await getVSCodeServerStatus(user.username);
      return reply.code(200).send({ success: true, data: status } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/users/:id/vscode-server/install-progress
   * Check real-time installation progress. Admin or self.
   * Returns the in-memory install tracking status (installing/success/failed).
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/users/:id/vscode-server/install-progress',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }

      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      if (!isAdmin && request.user!.userId !== userId) {
        return reply.code(403).send({ success: false, error: '无权访问' } as ApiResponse);
      }

      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;

      if (!user) {
        return reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      const progress = getInstallProgress(user.username);
      return reply.code(200).send({
        success: true,
        data: progress ?? { status: 'unknown' },
      } as ApiResponse);
    }
  );
}
