/**
 * Agent 路由模块
 *
 * 管理 Agent 实例资源，提供以下端点：
 *   - GET    /api/v1/agents           - 列出当前用户的所有 Agent
 *   - GET    /api/v1/agents/:id       - 获取单个 Agent 详情（含超能力配置）
 *   - POST   /api/v1/agents/:id/resume - 恢复被阻断/熔断的 Agent
 *   - POST   /api/v1/agents/:id/stop   - 停止单个 Agent
 *   - GET    /api/v1/agents/:id/logs   - 分页查询 Agent 相关系统事件
 *   - PUT    /api/v1/agents/:id/superpowers - 更新 Agent 超能力配置
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import {
  AgentInstance,
  AgentSuperpower,
  SystemEvent,
  ApiResponse,
} from '../types';

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/agents
   * List all agent instances for the authenticated user.
   * Optional query param: ?team_id=<number> to filter by team.
   */
  fastify.get<{ Querystring: { team_id?: string } }>(
    '/api/v1/agents',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Querystring: { team_id?: string } }>,
      reply: FastifyReply
    ) => {
      const db = getDb();
      const userId = request.user!.userId;
      const teamId = request.query.team_id
        ? parseInt(request.query.team_id, 10)
        : undefined;

      let agents: AgentInstance[];

      if (teamId !== undefined && !isNaN(teamId)) {
        // Filter by team_id, but still verify the team belongs to the user
        agents = db
          .prepare(
            `SELECT ai.* FROM agent_instances ai
             JOIN team_configs tc ON ai.team_config_id = tc.id
             WHERE tc.user_id = ? AND ai.team_config_id = ?
             ORDER BY ai.id ASC`
          )
          .all(userId, teamId) as AgentInstance[];
      } else {
        // Return all agents for teams owned by this user
        agents = db
          .prepare(
            `SELECT ai.* FROM agent_instances ai
             JOIN team_configs tc ON ai.team_config_id = tc.id
             WHERE tc.user_id = ?
             ORDER BY ai.id ASC`
          )
          .all(userId) as AgentInstance[];
      }

      return reply.code(200).send({
        success: true,
        data: agents,
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/agents/:id
   * Get a single agent's details, including superpowers config.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/agents/:id',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const agentId = parseInt(request.params.id, 10);
      if (isNaN(agentId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的 Agent ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Fetch agent and verify ownership via team_configs
      const agent = db
        .prepare(
          `SELECT ai.* FROM agent_instances ai
           JOIN team_configs tc ON ai.team_config_id = tc.id
           WHERE ai.id = ? AND tc.user_id = ?`
        )
        .get(agentId, userId) as AgentInstance | undefined;

      if (!agent) {
        return reply.code(404).send({
          success: false,
          error: 'Agent 不存在',
        } as ApiResponse);
      }

      // Fetch superpowers config if exists
      const superpowers = db
        .prepare(
          'SELECT * FROM agent_superpowers WHERE agent_instance_id = ?'
        )
        .get(agentId) as AgentSuperpower | undefined;

      return reply.code(200).send({
        success: true,
        data: {
          ...agent,
          superpowers: superpowers || null,
        },
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/agents/:id/resume
   * Resume a blocked/circuit-broken agent.
   * Resets error_count to 0, clears error_log, sets status to 'idle'.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/agents/:id/resume',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const agentId = parseInt(request.params.id, 10);
      if (isNaN(agentId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的 Agent ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Verify ownership
      const agent = db
        .prepare(
          `SELECT ai.* FROM agent_instances ai
           JOIN team_configs tc ON ai.team_config_id = tc.id
           WHERE ai.id = ? AND tc.user_id = ?`
        )
        .get(agentId, userId) as AgentInstance | undefined;

      if (!agent) {
        return reply.code(404).send({
          success: false,
          error: 'Agent 不存在',
        } as ApiResponse);
      }

      db.prepare(
        `UPDATE agent_instances
         SET status = 'idle', error_count = 0, error_log = NULL, updated_at = datetime('now')
         WHERE id = ?`
      ).run(agentId);

      const updatedAgent = db
        .prepare('SELECT * FROM agent_instances WHERE id = ?')
        .get(agentId) as AgentInstance;

      return reply.code(200).send({
        success: true,
        data: updatedAgent,
        message: 'Agent 恢复成功',
      } as ApiResponse);
    }
  );

  /**
   * POST /api/v1/agents/:id/stop
   * Stop a single agent by setting its status to 'suspended'.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/agents/:id/stop',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const agentId = parseInt(request.params.id, 10);
      if (isNaN(agentId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的 Agent ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Verify ownership
      const agent = db
        .prepare(
          `SELECT ai.* FROM agent_instances ai
           JOIN team_configs tc ON ai.team_config_id = tc.id
           WHERE ai.id = ? AND tc.user_id = ?`
        )
        .get(agentId, userId) as AgentInstance | undefined;

      if (!agent) {
        return reply.code(404).send({
          success: false,
          error: 'Agent 不存在',
        } as ApiResponse);
      }

      db.prepare(
        `UPDATE agent_instances
         SET status = 'suspended', updated_at = datetime('now')
         WHERE id = ?`
      ).run(agentId);

      const updatedAgent = db
        .prepare('SELECT * FROM agent_instances WHERE id = ?')
        .get(agentId) as AgentInstance;

      return reply.code(200).send({
        success: true,
        data: updatedAgent,
        message: 'Agent 停止成功',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/agents/:id/logs
   * Get system events related to a specific agent, with pagination.
   * Query params: ?page=1&limit=20
   */
  fastify.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    '/api/v1/agents/:id/logs',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { page?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const agentId = parseInt(request.params.id, 10);
      if (isNaN(agentId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的 Agent ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Verify ownership
      const agent = db
        .prepare(
          `SELECT ai.* FROM agent_instances ai
           JOIN team_configs tc ON ai.team_config_id = tc.id
           WHERE ai.id = ? AND tc.user_id = ?`
        )
        .get(agentId, userId) as AgentInstance | undefined;

      if (!agent) {
        return reply.code(404).send({
          success: false,
          error: 'Agent 不存在',
        } as ApiResponse);
      }

      const page = Math.max(1, parseInt(request.query.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const totalRow = db
        .prepare(
          'SELECT COUNT(*) as count FROM system_events WHERE agent_id = ?'
        )
        .get(agentId) as { count: number };

      const events = db
        .prepare(
          `SELECT * FROM system_events
           WHERE agent_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(agentId, limit, offset) as SystemEvent[];

      return reply.code(200).send({
        success: true,
        data: {
          events,
          total: totalRow.count,
          page,
          limit,
        },
      } as ApiResponse);
    }
  );

  /**
   * PUT /api/v1/agents/:id/superpowers
   * Update or create the superpowers configuration for an agent.
   * Body: { prompt_override?: string, rules_json?: string }
   */
  fastify.put<{
    Params: { id: string };
    Body: { prompt_override?: string; rules_json?: string };
  }>(
    '/api/v1/agents/:id/superpowers',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { prompt_override?: string; rules_json?: string };
      }>,
      reply: FastifyReply
    ) => {
      const agentId = parseInt(request.params.id, 10);
      if (isNaN(agentId)) {
        return reply.code(400).send({
          success: false,
          error: '无效的 Agent ID',
        } as ApiResponse);
      }

      const userId = request.user!.userId;
      const db = getDb();

      // Verify ownership
      const agent = db
        .prepare(
          `SELECT ai.* FROM agent_instances ai
           JOIN team_configs tc ON ai.team_config_id = tc.id
           WHERE ai.id = ? AND tc.user_id = ?`
        )
        .get(agentId, userId) as AgentInstance | undefined;

      if (!agent) {
        return reply.code(404).send({
          success: false,
          error: 'Agent 不存在',
        } as ApiResponse);
      }

      const { prompt_override, rules_json } = request.body;

      // Check if superpowers record already exists
      const existing = db
        .prepare(
          'SELECT * FROM agent_superpowers WHERE agent_instance_id = ?'
        )
        .get(agentId) as AgentSuperpower | undefined;

      if (existing) {
        // UPDATE existing record
        db.prepare(
          `UPDATE agent_superpowers
           SET prompt_override = ?, rules_json = ?, updated_at = datetime('now')
           WHERE agent_instance_id = ?`
        ).run(
          prompt_override ?? existing.prompt_override,
          rules_json ?? existing.rules_json,
          agentId
        );
      } else {
        // INSERT new record
        db.prepare(
          `INSERT INTO agent_superpowers (agent_instance_id, prompt_override, rules_json)
           VALUES (?, ?, ?)`
        ).run(agentId, prompt_override ?? null, rules_json ?? null);
      }

      const updatedSuperpowers = db
        .prepare(
          'SELECT * FROM agent_superpowers WHERE agent_instance_id = ?'
        )
        .get(agentId) as AgentSuperpower;

      return reply.code(200).send({
        success: true,
        data: updatedSuperpowers,
        message: '超能力配置更新成功',
      } as ApiResponse);
    }
  );
}
