/**
 * 模型凭证路由模块
 *
 * 管理 LLM 模型凭证（API Key），支持 Anthropic/Google/OpenAI 提供商：
 *   - GET    /api/v1/models          - 列出用户的模型凭证
 *   - POST   /api/v1/models          - 添加模型凭证（支持 upsert）
 *   - PUT    /api/v1/models/:id      - 更新模型凭证
 *   - DELETE /api/v1/models/:id      - 删除模型凭证
 *   - POST   /api/v1/models/:id/verify - 验证模型凭证的 API Key
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import { encrypt, decrypt } from '../services/crypto';
import {
  ModelCredential,
  ModelCredentialPublic,
  CreateModelBody,
  UpdateModelBody,
  ApiResponse,
} from '../types';

/** Strip api_key_enc from a model credential record */
function toPublicModel(model: ModelCredential): ModelCredentialPublic {
  const { api_key_enc, ...publicModel } = model;
  return publicModel;
}

export async function modelRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/models
   * List all model credentials for the authenticated user.
   */
  fastify.get<{ Querystring: { user_id?: string } }>(
    '/api/v1/models',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const db = getDb();
      const queryUserId = request.query.user_id;
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const userId = queryUserId && isAdmin
        ? Number(queryUserId)
        : request.user!.userId;

      const models = db
        .prepare(
          'SELECT * FROM model_credentials WHERE user_id = ? ORDER BY id ASC'
        )
        .all(userId) as ModelCredential[];

      return reply.code(200).send({
        success: true,
        data: models.map(toPublicModel),
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/models
   * Add a new model credential. The API key is encrypted before storage.
   */
  fastify.post<{ Body: CreateModelBody }>(
    '/api/v1/models',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: CreateModelBody }>,
      reply: FastifyReply
    ) => {
      const { provider, model_name, api_key, quota_limit, is_verified, user_id: targetUserId } = request.body;
      // Admin/super_admin can create models for other users via user_id body param
      const callerRole = request.user!.role;
      const userId = targetUserId && (callerRole === 'super_admin' || callerRole === 'admin')
        ? targetUserId
        : request.user!.userId;

      if (!provider || !model_name) {
        return reply.code(400).send({
          success: false,
          error: '提供商和模型名称为必填',
        } as ApiResponse);
      }

      const validProviders = ['anthropic', 'google', 'openai'];
      if (!validProviders.includes(provider)) {
        return reply.code(400).send({
          success: false,
          error: '无效的模型提供商',
        } as ApiResponse);
      }

      // Encrypt the API key before storing (allow empty for auth-string flow)
      const apiKeyEnc = api_key ? encrypt(api_key) : '';
      const verified = is_verified ? 1 : 0;

      const db = getDb();

      // Upsert: if same (user_id, provider, model_name) exists, update
      const existing = db
        .prepare(
          'SELECT * FROM model_credentials WHERE user_id = ? AND provider = ? AND model_name = ?'
        )
        .get(userId, provider, model_name) as ModelCredential | undefined;

      let newModel: ModelCredential;
      if (existing) {
        db.prepare(
          `UPDATE model_credentials SET api_key_enc = ?, quota_limit = ?, is_verified = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(apiKeyEnc, quota_limit ?? null, verified, existing.id);
        newModel = db
          .prepare('SELECT * FROM model_credentials WHERE id = ?')
          .get(existing.id) as ModelCredential;
      } else {
        const result = db
          .prepare(
            `INSERT INTO model_credentials (user_id, provider, model_name, api_key_enc, quota_limit, is_verified)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(userId, provider, model_name, apiKeyEnc, quota_limit ?? null, verified);
        newModel = db
          .prepare('SELECT * FROM model_credentials WHERE id = ?')
          .get(result.lastInsertRowid) as ModelCredential;
      }

      // Generate auth_string based on model id
      const authString = `SWT-AUTH-${newModel.id}-${provider}-${model_name}-${Date.now().toString(36)}`;

      return reply.code(201).send({
        success: true,
        data: { ...toPublicModel(newModel), auth_string: authString },
        message: '模型凭证添加成功',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/models/:id
   * Update an existing model credential.
   */
  fastify.put<{ Params: { id: string }; Body: UpdateModelBody }>(
    '/api/v1/models/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateModelBody;
      }>,
      reply: FastifyReply
    ) => {
      const modelId = parseInt(request.params.id, 10);
      if (isNaN(modelId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的模型 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM model_credentials WHERE id = ? AND user_id = ?'
        )
        .get(modelId, userId) as ModelCredential | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '模型凭证不存在',
        } as ApiResponse);
      }

      const { provider, model_name, api_key, quota_limit } = request.body;
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (provider !== undefined) {
        const validProviders = ['anthropic', 'google', 'openai'];
        if (!validProviders.includes(provider)) {
          return reply.code(400).send({
            success: false,
            error: '无效的模型提供商',
          } as ApiResponse);
        }
        updates.push('provider = ?');
        values.push(provider);
      }

      if (model_name !== undefined) {
        updates.push('model_name = ?');
        values.push(model_name);
      }

      if (api_key !== undefined) {
        // Re-encrypt the new API key
        updates.push('api_key_enc = ?');
        values.push(encrypt(api_key));
        // Reset verification status when key changes
        updates.push('is_verified = 0');
      }

      if (quota_limit !== undefined) {
        updates.push('quota_limit = ?');
        values.push(quota_limit);
      }

      if (updates.length === 0) {
        return reply.code(400).send({
          success: false,
          error: '没有需要更新的字段',
        } as ApiResponse);
      }

      updates.push("updated_at = datetime('now')");
      values.push(modelId);
      values.push(userId);

      db.prepare(
        `UPDATE model_credentials SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...values);

      const updatedModel = db
        .prepare('SELECT * FROM model_credentials WHERE id = ?')
        .get(modelId) as ModelCredential;

      return reply.code(200).send({
        success: true,
        data: toPublicModel(updatedModel),
        message: '模型凭证更新成功',
      } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/models/:id
   * Delete a model credential.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/models/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const modelId = parseInt(request.params.id, 10);
      if (isNaN(modelId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的模型 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM model_credentials WHERE id = ? AND user_id = ?'
        )
        .get(modelId, userId) as ModelCredential | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '模型凭证不存在',
        } as ApiResponse);
      }

      db.prepare(
        'DELETE FROM model_credentials WHERE id = ? AND user_id = ?'
      ).run(modelId, userId);

      return reply.code(200).send({
        success: true,
        message: '模型凭证删除成功',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/models/:id/verify
   * Verify a model credential's API key.
   * Currently mocked to always return success.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/models/:id/verify',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const modelId = parseInt(request.params.id, 10);
      if (isNaN(modelId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的模型 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const existing = db
        .prepare(
          'SELECT * FROM model_credentials WHERE id = ? AND user_id = ?'
        )
        .get(modelId, userId) as ModelCredential | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '模型凭证不存在',
        } as ApiResponse);
      }

      // TODO: Actually verify the API key by making a test request to the provider
      // For now, mock success
      db.prepare(
        "UPDATE model_credentials SET is_verified = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
      ).run(modelId, userId);

      const updatedModel = db
        .prepare('SELECT * FROM model_credentials WHERE id = ?')
        .get(modelId) as ModelCredential;

      return reply.code(200).send({
        success: true,
        data: toPublicModel(updatedModel),
        message: '模型凭证验证成功（模拟）',
      } as ApiResponse);
    }
  );
}
