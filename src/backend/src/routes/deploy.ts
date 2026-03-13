/**
 * 部署配置路由模块
 *
 * 管理部署配置资源（本地/云端/手动），提供以下端点：
 *   - GET    /api/v1/deploy                - 列出用户的部署配置
 *   - POST   /api/v1/deploy                - 创建部署配置
 *   - PUT    /api/v1/deploy/:id            - 更新部署配置
 *   - DELETE /api/v1/deploy/:id            - 删除部署配置
 *   - POST   /api/v1/deploy/test-connection - 测试 SSH 连接
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import { encrypt, decrypt } from '../services/crypto';
import {
  DeploymentConfig,
  DeploymentConfigPublic,
  CreateDeployBody,
  TestDeployConnectionBody,
  ApiResponse,
  User,
} from '../types';
import { createChildLogger } from '../services/logger';
import { generateDeployYaml } from '../services/deploy-yaml-generator';
import type { GitSpec } from '../services/deploy-yaml-generator';

const log = createChildLogger('Deploy');

/** Strip cloud_pass_enc and ssh_key_enc from a deployment config record */
function toPublicDeploy(config: DeploymentConfig): DeploymentConfigPublic {
  const { cloud_pass_enc, ssh_key_enc, ...publicConfig } = config;
  return publicConfig;
}

export async function deployRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/deploy
   * Get all deployment configurations for the authenticated user.
   */
  fastify.get<{ Querystring: { user_id?: string } }>(
    '/api/v1/deploy',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const db = getDb();
      const queryUserId = request.query.user_id;
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const userId = queryUserId && isAdmin
        ? Number(queryUserId)
        : request.user!.userId;

      const configs = db
        .prepare(
          'SELECT * FROM deployment_configs WHERE user_id = ? ORDER BY id ASC'
        )
        .all(userId) as DeploymentConfig[];

      return reply.code(200).send({
        success: true,
        data: configs.map(toPublicDeploy),
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/deploy
   * Create a new deployment configuration.
   * Accepts: { deployType, serverIp?, port?, username?, password?, sshKey? }
   */
  fastify.post<{ Body: CreateDeployBody }>(
    '/api/v1/deploy',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: CreateDeployBody }>,
      reply: FastifyReply
    ) => {
      const { deployType, serverIp, port, username, password, sshKey, user_id: targetUserId, gitRepoUrl, gitBranch, gitToken } =
        request.body;
      const callerRole = request.user!.role;
      const userId = targetUserId && (callerRole === 'super_admin' || callerRole === 'admin')
        ? targetUserId
        : request.user!.userId;

      if (!deployType) {
        return reply.code(400).send({
          success: false,
          error: 'deployType is required',
        } as ApiResponse);
      }

      const validTypes = ['local', 'cloud', 'manual'];
      if (!validTypes.includes(deployType)) {
        return reply.code(400).send({
          success: false,
          error: '无效的部署类型',
        } as ApiResponse);
      }

      // For cloud deployments, serverIp and username are typically required
      if (deployType === 'cloud' && (!serverIp || !username)) {
        return reply.code(400).send({
          success: false,
          error:
            'serverIp and username are required for cloud deployment',
        } as ApiResponse);
      }

      // Encrypt sensitive fields
      const cloudPassEnc = password ? encrypt(password) : null;
      const sshKeyEnc = sshKey ? encrypt(sshKey) : null;
      const cloudPort = port ? parseInt(String(port), 10) : 22;

      const db = getDb();
      const result = db
        .prepare(
          `INSERT INTO deployment_configs (user_id, deploy_type, cloud_host, cloud_port, cloud_user, cloud_pass_enc, ssh_key_enc)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          deployType,
          serverIp ?? null,
          cloudPort,
          username ?? null,
          cloudPassEnc,
          sshKeyEnc
        );

      const newConfig = db
        .prepare('SELECT * FROM deployment_configs WHERE id = ?')
        .get(result.lastInsertRowid) as DeploymentConfig;

      log.info({ userId, deployType, configId: newConfig.id }, 'Deploy config created');

      // Fire-and-forget: generate deploy.yaml for cloud deployments
      if (deployType === 'cloud' && serverIp && username) {
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as Pick<User, 'username'> | undefined;
        if (user) {
          const plainPassword = cloudPassEnc ? decrypt(cloudPassEnc) : '';
          const gitSpecArg: GitSpec | undefined = gitRepoUrl
            ? { repoUrl: gitRepoUrl, branch: gitBranch || 'main', token: gitToken || '' }
            : undefined;
          generateDeployYaml(user.username, [{
            name: 'dev',
            host: serverIp,
            port: cloudPort,
            user: username,
            password: plainPassword,
          }], gitSpecArg).then((r) => {
            if (!r.success) {
              log.error({ username: user.username, error: r.error }, 'deploy.yaml generation failed');
            }
          }).catch((err) => {
            log.error({ username: user.username, err }, 'deploy.yaml generation error');
          });
        }
      }

      return reply.code(201).send({
        success: true,
        data: toPublicDeploy(newConfig),
        message: '部署配置创建成功',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/deploy/:id
   * Update an existing deployment configuration.
   */
  fastify.put<{ Params: { id: string }; Body: CreateDeployBody }>(
    '/api/v1/deploy/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: CreateDeployBody;
      }>,
      reply: FastifyReply
    ) => {
      const configId = parseInt(request.params.id, 10);
      if (isNaN(configId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的部署配置 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM deployment_configs WHERE id = ? AND user_id = ?'
        )
        .get(configId, userId) as DeploymentConfig | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '部署配置不存在',
        } as ApiResponse);
      }

      const { deployType, serverIp, port, username, password, sshKey } =
        request.body;
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (deployType !== undefined) {
        const validTypes = ['local', 'cloud', 'manual'];
        if (!validTypes.includes(deployType)) {
          return reply.code(400).send({
            success: false,
            error:
              'Invalid deployType. Must be "local", "cloud", or "manual"',
          } as ApiResponse);
        }
        updates.push('deploy_type = ?');
        values.push(deployType);
      }

      if (serverIp !== undefined) {
        updates.push('cloud_host = ?');
        values.push(serverIp);
      }

      if (port !== undefined) {
        updates.push('cloud_port = ?');
        values.push(parseInt(String(port), 10));
      }

      if (username !== undefined) {
        updates.push('cloud_user = ?');
        values.push(username);
      }

      if (password !== undefined) {
        updates.push('cloud_pass_enc = ?');
        values.push(encrypt(password));
      }

      if (sshKey !== undefined) {
        updates.push('ssh_key_enc = ?');
        values.push(encrypt(sshKey));
      }

      if (updates.length === 0) {
        return reply.code(400).send({
          success: false,
          error: '没有需要更新的字段',
        } as ApiResponse);
      }

      updates.push("updated_at = datetime('now')");
      values.push(configId);
      values.push(userId);

      db.prepare(
        `UPDATE deployment_configs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...values);

      const updatedConfig = db
        .prepare('SELECT * FROM deployment_configs WHERE id = ?')
        .get(configId) as DeploymentConfig;

      return reply.code(200).send({
        success: true,
        data: toPublicDeploy(updatedConfig),
        message: '部署配置更新成功',
      } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/deploy/:id
   * Delete a deployment configuration.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/deploy/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const configId = parseInt(request.params.id, 10);
      if (isNaN(configId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的部署配置 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM deployment_configs WHERE id = ? AND user_id = ?'
        )
        .get(configId, userId) as DeploymentConfig | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '部署配置不存在',
        } as ApiResponse);
      }

      db.prepare(
        'DELETE FROM deployment_configs WHERE id = ? AND user_id = ?'
      ).run(configId, userId);

      return reply.code(200).send({
        success: true,
        message: '部署配置删除成功',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/deploy/test-connection
   * Test SSH connection to a deployment target.
   * Currently a mock implementation.
   */
  fastify.post<{ Body: TestDeployConnectionBody }>(
    '/api/v1/deploy/test-connection',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: TestDeployConnectionBody }>,
      reply: FastifyReply
    ) => {
      const { serverIp, port, username, password, sshKey } = request.body;

      // Validate required fields
      if (!serverIp || !username) {
        return reply.code(400).send({
          success: false,
          error: 'serverIp and username are required',
        } as ApiResponse);
      }

      if (!password && !sshKey) {
        return reply.code(400).send({
          success: false,
          error: '请提供密码或 SSH 密钥',
        } as ApiResponse);
      }

      // TODO: Actually perform an SSH connection test
      // For now, mock success
      return reply.code(200).send({
        success: true,
        data: {
          success: true,
          message: 'SSH 连接测试通过（模拟）',
        },
      } as ApiResponse);
    }
  );
}
