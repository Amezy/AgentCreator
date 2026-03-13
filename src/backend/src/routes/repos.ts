/**
 * Git 仓库配置路由模块
 *
 * 管理 Git 仓库配置资源，支持 GitHub/GitLab/Gitee/自定义平台：
 *   - GET    /api/v1/repos                 - 列出用户的仓库配置
 *   - POST   /api/v1/repos                 - 添加仓库配置
 *   - PUT    /api/v1/repos/:id             - 更新仓库配置
 *   - DELETE /api/v1/repos/:id             - 删除仓库配置
 *   - POST   /api/v1/repos/test-connection - 测试仓库连接（未保存）
 *   - POST   /api/v1/repos/:id/test        - 测试已保存仓库的连接
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import { encrypt } from '../services/crypto';
import {
  GitRepository,
  GitRepositoryPublic,
  CreateRepoBody,
  TestRepoConnectionBody,
  ApiResponse,
} from '../types';

/** Strip auth_cred_enc from a git repository record */
function toPublicRepo(repo: GitRepository): GitRepositoryPublic {
  const { auth_cred_enc, ...publicRepo } = repo;
  return publicRepo;
}

export async function repoRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/repos
   * List all git repository configurations for the authenticated user.
   */
  fastify.get<{ Querystring: { user_id?: string } }>(
    '/api/v1/repos',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const db = getDb();
      const queryUserId = request.query.user_id;
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const userId = queryUserId && isAdmin
        ? Number(queryUserId)
        : request.user!.userId;

      const repos = db
        .prepare(
          'SELECT * FROM git_repositories WHERE user_id = ? ORDER BY id ASC'
        )
        .all(userId) as GitRepository[];

      return reply.code(200).send({
        success: true,
        data: repos.map(toPublicRepo),
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/repos
   * Add a new git repository.
   * Accepts: { platform, repoUrl, authMethod, credential }
   */
  fastify.post<{ Body: CreateRepoBody }>(
    '/api/v1/repos',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: CreateRepoBody }>,
      reply: FastifyReply
    ) => {
      const { platform, repoUrl, authMethod, credential, user_id: targetUserId, is_verified } = request.body;
      const callerRole = request.user!.role;
      const userId = targetUserId && (callerRole === 'super_admin' || callerRole === 'admin')
        ? targetUserId
        : request.user!.userId;

      if (!platform || !repoUrl || !authMethod || !credential) {
        return reply.code(400).send({
          success: false,
          error: 'platform, repoUrl, authMethod, and credential are required',
        } as ApiResponse);
      }

      const validPlatforms = ['github', 'gitlab', 'gitee', 'custom'];
      if (!validPlatforms.includes(platform)) {
        return reply.code(400).send({
          success: false,
          error:
            'Invalid platform. Must be "github", "gitlab", "gitee", or "custom"',
        } as ApiResponse);
      }

      const validAuthMethods = ['token', 'ssh_key'];
      if (!validAuthMethods.includes(authMethod)) {
        return reply.code(400).send({
          success: false,
          error: '无效的认证方式',
        } as ApiResponse);
      }

      // Encrypt the credential before storing
      const authCredEnc = encrypt(credential);

      const db = getDb();
      const result = db
        .prepare(
          `INSERT INTO git_repositories (user_id, platform, remote_url, auth_type, auth_cred_enc, is_verified)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(userId, platform, repoUrl, authMethod, authCredEnc, is_verified ? 1 : 0);

      const newRepo = db
        .prepare('SELECT * FROM git_repositories WHERE id = ?')
        .get(result.lastInsertRowid) as GitRepository;

      return reply.code(201).send({
        success: true,
        data: toPublicRepo(newRepo),
        message: '仓库添加成功',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/repos/:id
   * Update an existing git repository configuration.
   */
  fastify.put<{ Params: { id: string }; Body: CreateRepoBody }>(
    '/api/v1/repos/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: CreateRepoBody;
      }>,
      reply: FastifyReply
    ) => {
      const repoId = parseInt(request.params.id, 10);
      if (isNaN(repoId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的仓库 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM git_repositories WHERE id = ? AND user_id = ?'
        )
        .get(repoId, userId) as GitRepository | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '仓库不存在',
        } as ApiResponse);
      }

      const { platform, repoUrl, authMethod, credential } = request.body;
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (platform !== undefined) {
        const validPlatforms = ['github', 'gitlab', 'gitee', 'custom'];
        if (!validPlatforms.includes(platform)) {
          return reply.code(400).send({
            success: false,
            error:
              'Invalid platform. Must be "github", "gitlab", "gitee", or "custom"',
          } as ApiResponse);
        }
        updates.push('platform = ?');
        values.push(platform);
      }

      if (repoUrl !== undefined) {
        updates.push('remote_url = ?');
        values.push(repoUrl);
      }

      if (authMethod !== undefined) {
        const validAuthMethods = ['token', 'ssh_key'];
        if (!validAuthMethods.includes(authMethod)) {
          return reply.code(400).send({
            success: false,
            error: '无效的认证方式',
          } as ApiResponse);
        }
        updates.push('auth_type = ?');
        values.push(authMethod);
      }

      if (credential !== undefined) {
        // Re-encrypt the new credential
        updates.push('auth_cred_enc = ?');
        values.push(encrypt(credential));
        // Reset verification status when credential changes
        updates.push('is_verified = 0');
      }

      if (updates.length === 0) {
        return reply.code(400).send({
          success: false,
          error: '没有需要更新的字段',
        } as ApiResponse);
      }

      updates.push("updated_at = datetime('now')");
      values.push(repoId);
      values.push(userId);

      db.prepare(
        `UPDATE git_repositories SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...values);

      const updatedRepo = db
        .prepare('SELECT * FROM git_repositories WHERE id = ?')
        .get(repoId) as GitRepository;

      return reply.code(200).send({
        success: true,
        data: toPublicRepo(updatedRepo),
        message: '仓库更新成功',
      } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/repos/:id
   * Delete a git repository configuration.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/repos/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const repoId = parseInt(request.params.id, 10);
      if (isNaN(repoId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的仓库 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM git_repositories WHERE id = ? AND user_id = ?'
        )
        .get(repoId, userId) as GitRepository | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '仓库不存在',
        } as ApiResponse);
      }

      db.prepare(
        'DELETE FROM git_repositories WHERE id = ? AND user_id = ?'
      ).run(repoId, userId);

      return reply.code(200).send({
        success: true,
        message: '仓库删除成功',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/repos/test-connection
   * Test a repository connection (before saving).
   * Currently a mock implementation.
   */
  fastify.post<{ Body: TestRepoConnectionBody }>(
    '/api/v1/repos/test-connection',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: TestRepoConnectionBody }>,
      reply: FastifyReply
    ) => {
      const { platform, repoUrl, authMethod, credential } = request.body;

      // Validate required fields
      if (!platform || !repoUrl || !authMethod || !credential) {
        return reply.code(400).send({
          success: false,
          error:
            'platform, repoUrl, authMethod, and credential are required',
        } as ApiResponse);
      }

      // TODO: Actually perform a git connection test (e.g., git ls-remote)
      // For now, mock success
      return reply.code(200).send({
        success: true,
        data: {
          success: true,
          message: '仓库连接测试通过（模拟）',
        },
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/repos/:id/test
   * Test connection for an already-saved repository.
   * Currently a mock implementation.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/repos/:id/test',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const repoId = parseInt(request.params.id, 10);
      if (isNaN(repoId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的仓库 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM git_repositories WHERE id = ? AND user_id = ?'
        )
        .get(repoId, userId) as GitRepository | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '仓库不存在',
        } as ApiResponse);
      }

      // TODO: Actually perform a git connection test using stored credentials
      // For now, mock success and mark as verified
      db.prepare(
        "UPDATE git_repositories SET is_verified = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
      ).run(repoId, userId);

      const updatedRepo = db
        .prepare('SELECT * FROM git_repositories WHERE id = ?')
        .get(repoId) as GitRepository;

      return reply.code(200).send({
        success: true,
        data: toPublicRepo(updatedRepo),
        message: 'Repository connection test passed (mock)',
      } as ApiResponse);
    }
  );
}
