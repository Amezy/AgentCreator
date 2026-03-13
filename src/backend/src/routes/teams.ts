/**
 * 团队配置路由模块
 *
 * 管理 Agent 团队配置资源，控制各角色的 Agent 数量和模型分配：
 *   - GET    /api/v1/teams            - 列出用户的团队配置
 *   - POST   /api/v1/teams            - 创建团队配置
 *   - PUT    /api/v1/teams/:id        - 更新团队配置
 *   - DELETE /api/v1/teams/:id        - 删除团队配置
 *   - POST   /api/v1/teams/:id/launch - 启动团队（创建 Agent 实例）
 *   - POST   /api/v1/teams/:id/stop   - 停止团队（挂起所有 Agent）
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import {
  TeamConfig,
  AgentInstance,
  ModelCredential,
  CreateTeamBody,
  UpdateTeamBody,
  ApiResponse,
  User,
} from '../types';
import { createChildLogger } from '../services/logger';
import { generateClaudeMd, RoleModelPair } from '../services/claude-md-generator';

const log = createChildLogger('Teams');

/** Resolve team model IDs to role:modelName pairs for CLAUDE.md generation */
function resolveTeamModels(
  db: ReturnType<typeof getDb>,
  team: TeamConfig
): RoleModelPair[] {
  const roleModelFields: { role: string; modelId: number | null }[] = [
    { role: 'architect', modelId: team.architect_model_id },
    { role: 'frontend', modelId: team.frontend_model_id },
    { role: 'backend', modelId: team.backend_model_id },
    { role: 'reviewer', modelId: team.reviewer_model_id },
    { role: 'devops', modelId: team.devops_model_id },
  ];

  const pairs: RoleModelPair[] = [];
  for (const { role, modelId } of roleModelFields) {
    if (modelId === null) continue;
    const cred = db.prepare('SELECT model_name FROM model_credentials WHERE id = ?').get(modelId) as Pick<ModelCredential, 'model_name'> | undefined;
    if (cred) {
      pairs.push({ role, modelName: cred.model_name });
    }
  }
  return pairs;
}

/** Fire-and-forget CLAUDE.md generation for a team config */
function triggerClaudeMdGeneration(db: ReturnType<typeof getDb>, team: TeamConfig, userId: number): void {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as Pick<User, 'username'> | undefined;
  if (!user) {
    log.warn({ userId }, 'Cannot generate CLAUDE.md: user not found');
    return;
  }

  const pairs = resolveTeamModels(db, team);
  if (pairs.length === 0) {
    log.info({ userId }, 'No model assignments to generate CLAUDE.md');
    return;
  }

  generateClaudeMd(user.username, pairs).then((r) => {
    if (!r.success) {
      log.error({ username: user.username, error: r.error }, 'CLAUDE.md generation failed');
    }
  }).catch((err) => {
    log.error({ username: user.username, err }, 'CLAUDE.md generation error');
  });
}

export async function teamRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/teams
   * List all team configurations for the authenticated user.
   */
  fastify.get<{ Querystring: { user_id?: string } }>(
    '/api/v1/teams',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const db = getDb();
      // Admin users can query other users' data via ?user_id=X
      const queryUserId = request.query.user_id;
      const isAdminGet = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const userId = (queryUserId && isAdminGet)
        ? Number(queryUserId)
        : request.user!.userId;

      const teams = db
        .prepare(
          'SELECT * FROM team_configs WHERE user_id = ? ORDER BY id ASC'
        )
        .all(userId) as TeamConfig[];

      return reply.code(200).send({
        success: true,
        data: teams,
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/teams
   * Create a new team configuration.
   * Accepts either:
   *   - { agents: [{ role, count, superpowersPrompt }] }  (frontend format)
   *   - { config_name, frontend_count, backend_count }      (standard format)
   */
  fastify.post<{ Body: CreateTeamBody }>(
    '/api/v1/teams',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: CreateTeamBody }>,
      reply: FastifyReply
    ) => {
      const body = request.body;
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      // Admin can create teams for other users via body.user_id
      const userId = (isAdmin && body.user_id) ? body.user_id : request.user!.userId;

      let configName = body.config_name ?? 'default';
      const architectModelId = body.architect_model_id ?? null;
      const frontendModelId = body.frontend_model_id ?? null;
      const backendModelId = body.backend_model_id ?? null;
      const reviewerModelId = body.reviewer_model_id ?? null;
      const devopsModelId = body.devops_model_id ?? null;

      // All role counts are fixed at 1
      const architectCount = 1;
      const frontendCount = 1;
      const backendCount = 1;
      const reviewerCount = 1;
      const devopsCount = 1;

      const db = getDb();

      // Enforce one team per user
      const existingTeam = db
        .prepare('SELECT id FROM team_configs WHERE user_id = ?')
        .get(userId) as { id: number } | undefined;
      if (existingTeam) {
        return reply.code(409).send({
          success: false,
          error: '每个用户仅可创建一个团队，请编辑或删除现有团队',
        } as ApiResponse);
      }

      const result = db
        .prepare(
          `INSERT INTO team_configs (user_id, config_name, architect_count, frontend_count, backend_count, reviewer_count, devops_count, architect_model_id, frontend_model_id, backend_model_id, reviewer_model_id, devops_model_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          configName,
          architectCount,
          frontendCount,
          backendCount,
          reviewerCount,
          devopsCount,
          architectModelId,
          frontendModelId,
          backendModelId,
          reviewerModelId,
          devopsModelId
        );

      const newTeam = db
        .prepare('SELECT * FROM team_configs WHERE id = ?')
        .get(result.lastInsertRowid) as TeamConfig;

      // Fire-and-forget: generate CLAUDE.md for the user
      triggerClaudeMdGeneration(db, newTeam, userId);

      return reply.code(201).send({
        success: true,
        data: newTeam,
        message: '团队配置创建成功',
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/teams/:id
   * Update an existing team configuration.
   */
  fastify.put<{ Params: { id: string }; Body: UpdateTeamBody }>(
    '/api/v1/teams/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateTeamBody;
      }>,
      reply: FastifyReply
    ) => {
      const teamId = parseInt(request.params.id, 10);
      if (isNaN(teamId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的团队 ID',
        } as ApiResponse);
      }

      const isAdminUser = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const db = getDb();

      // Check ownership (admin can edit any team)
      const existing = isAdminUser
        ? db.prepare('SELECT * FROM team_configs WHERE id = ?').get(teamId) as TeamConfig | undefined
        : db.prepare('SELECT * FROM team_configs WHERE id = ? AND user_id = ?').get(teamId, request.user!.userId) as TeamConfig | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '团队配置不存在',
        } as ApiResponse);
      }

      const { config_name, architect_model_id, frontend_model_id, backend_model_id, reviewer_model_id, devops_model_id } = request.body;
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (config_name !== undefined) {
        updates.push('config_name = ?');
        values.push(config_name);
      }

      // frontend_count and backend_count are fixed at 1, not updatable

      if (architect_model_id !== undefined) {
        updates.push('architect_model_id = ?');
        values.push(architect_model_id);
      }
      if (frontend_model_id !== undefined) {
        updates.push('frontend_model_id = ?');
        values.push(frontend_model_id);
      }
      if (backend_model_id !== undefined) {
        updates.push('backend_model_id = ?');
        values.push(backend_model_id);
      }
      if (reviewer_model_id !== undefined) {
        updates.push('reviewer_model_id = ?');
        values.push(reviewer_model_id);
      }
      if (devops_model_id !== undefined) {
        updates.push('devops_model_id = ?');
        values.push(devops_model_id);
      }

      if (updates.length === 0) {
        return reply.code(400).send({
          success: false,
          error: '没有需要更新的字段',
        } as ApiResponse);
      }

      updates.push("updated_at = datetime('now')");
      values.push(teamId);

      db.prepare(
        `UPDATE team_configs SET ${updates.join(', ')} WHERE id = ?`
      ).run(...values);

      const updatedTeam = db
        .prepare('SELECT * FROM team_configs WHERE id = ?')
        .get(teamId) as TeamConfig;

      // Fire-and-forget: regenerate CLAUDE.md with updated model assignments
      triggerClaudeMdGeneration(db, updatedTeam, existing.user_id);

      return reply.code(200).send({
        success: true,
        data: updatedTeam,
        message: '团队配置更新成功',
      } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/teams/:id
   * Delete a team configuration.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/teams/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const teamId = parseInt(request.params.id, 10);
      if (isNaN(teamId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的团队 ID',
        } as ApiResponse);
      }

      const isAdminDel = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      const db = getDb();

      // Check ownership (admin can delete any team)
      const existing = isAdminDel
        ? db.prepare('SELECT * FROM team_configs WHERE id = ?').get(teamId) as TeamConfig | undefined
        : db.prepare('SELECT * FROM team_configs WHERE id = ? AND user_id = ?').get(teamId, request.user!.userId) as TeamConfig | undefined;

      if (!existing) {
        return reply.code(404).send({
          success: false,
          error: '团队配置不存在',
        } as ApiResponse);
      }

      db.prepare('DELETE FROM team_configs WHERE id = ?').run(teamId);

      return reply.code(200).send({
        success: true,
        message: '团队配置删除成功',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/teams/:id/launch
   * Launch a team — create agent_instances records with status 'idle'.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/teams/:id/launch',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const teamId = parseInt(request.params.id, 10);
      if (isNaN(teamId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的团队 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const team = db
        .prepare(
          'SELECT * FROM team_configs WHERE id = ? AND user_id = ?'
        )
        .get(teamId, userId) as TeamConfig | undefined;

      if (!team) {
        return reply.code(404).send({
          success: false,
          error: '团队配置不存在',
        } as ApiResponse);
      }

      // Check if team already has active (non-suspended) agents
      const activeAgents = db
        .prepare(
          "SELECT COUNT(*) as count FROM agent_instances WHERE team_config_id = ? AND status != 'suspended'"
        )
        .get(teamId) as { count: number };

      if (activeAgents.count > 0) {
        return reply.code(409).send({
          success: false,
          error: '团队中仍有运行中的 Agent，请先停止',
        } as ApiResponse);
      }

      // Build the list of agents to create based on team config
      const agentsToCreate: { role: string; count: number }[] = [
        { role: 'architect', count: team.architect_count },
        { role: 'frontend', count: team.frontend_count },
        { role: 'backend', count: team.backend_count },
        { role: 'reviewer', count: team.reviewer_count },
        { role: 'devops', count: team.devops_count },
      ];

      const insertStmt = db.prepare(
        `INSERT INTO agent_instances (team_config_id, role, status, model_name)
         VALUES (?, ?, 'idle', 'default')`
      );

      const insertMany = db.transaction(() => {
        for (const agentDef of agentsToCreate) {
          for (let i = 0; i < agentDef.count; i++) {
            insertStmt.run(teamId, agentDef.role);
          }
        }
      });

      insertMany();

      // Fetch created agents
      const agents = db
        .prepare(
          "SELECT * FROM agent_instances WHERE team_config_id = ? AND status = 'idle' ORDER BY id ASC"
        )
        .all(teamId) as AgentInstance[];

      log.info({ teamId, userId, agentCount: agents.length }, 'Team launched');

      return reply.code(201).send({
        success: true,
        data: agents,
        message: `Team launched with ${agents.length} agents`,
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/teams/:id/stop
   * Stop a team — set all agent_instances status to 'suspended'.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/teams/:id/stop',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const teamId = parseInt(request.params.id, 10);
      if (isNaN(teamId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的团队 ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Check ownership
      const team = db
        .prepare(
          'SELECT * FROM team_configs WHERE id = ? AND user_id = ?'
        )
        .get(teamId, userId) as TeamConfig | undefined;

      if (!team) {
        return reply.code(404).send({
          success: false,
          error: '团队配置不存在',
        } as ApiResponse);
      }

      // Update all non-suspended agents to suspended
      const result = db
        .prepare(
          "UPDATE agent_instances SET status = 'suspended', updated_at = datetime('now') WHERE team_config_id = ? AND status != 'suspended'"
        )
        .run(teamId);

      log.info({ teamId, userId, suspendedCount: result.changes }, 'Team stopped');

      return reply.code(200).send({
        success: true,
        message: `Team stopped. ${result.changes} agent(s) suspended.`,
      } as ApiResponse);
    }
  );
}
