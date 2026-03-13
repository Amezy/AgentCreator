/**
 * 系统监控路由模块
 *
 * 提供系统健康检查、资源监控和事件日志查询：
 *   - GET /api/v1/system/health    - 系统健康检查（无需认证）
 *   - GET /api/v1/system/resources - CPU/内存/磁盘使用率及告警
 *   - GET /api/v1/system/events    - 系统事件日志（支持过滤和分页）
 */
import os from 'os';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import { SystemEvent, EventType, Severity, ApiResponse } from '../types';

/** Determine alert level based on percentage */
function getAlertLevel(percent: number): 'normal' | 'warn' | 'critical' {
  if (percent >= 95) return 'critical';
  if (percent >= 85) return 'warn';
  return 'normal';
}

export async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/system/health
   * System health check — no authentication required.
   */
  fastify.get(
    '/api/v1/system/health',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let dbStatus = 'connected';

      try {
        const db = getDb();
        // Simple query to verify the database connection is alive
        db.prepare('SELECT 1').get();
      } catch {
        dbStatus = 'disconnected';
      }

      return reply.code(200).send({
        success: true,
        data: {
          status: dbStatus === 'connected' ? 'ok' : 'degraded',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          uptime: process.uptime(),
          database: dbStatus,
        },
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/system/resources
   * CPU, memory, and disk usage stats with alert thresholds.
   */
  fastify.get(
    '/api/v1/system/resources',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // CPU info
      const cpus = os.cpus();
      const cores = cpus.length;

      // Calculate average CPU usage across all cores
      let totalIdle = 0;
      let totalTick = 0;
      for (const cpu of cpus) {
        const { user, nice, sys, idle, irq } = cpu.times;
        totalTick += user + nice + sys + idle + irq;
        totalIdle += idle;
      }
      const cpuPercent = parseFloat(
        (((totalTick - totalIdle) / totalTick) * 100).toFixed(1)
      );

      // Memory info
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = parseFloat(
        ((usedMem / totalMem) * 100).toFixed(1)
      );
      const usedMB = Math.round(usedMem / (1024 * 1024));
      const totalMB = Math.round(totalMem / (1024 * 1024));

      // Disk info (mock — cross-platform disk stats are complex)
      const diskPercent = 50.0;

      const memAlert = getAlertLevel(memPercent);
      const diskAlert = getAlertLevel(diskPercent);

      return reply.code(200).send({
        success: true,
        data: {
          cpu: { percent: cpuPercent, cores },
          memory: {
            percent: memPercent,
            usedMB,
            totalMB,
            alert: memAlert,
          },
          disk: {
            percent: diskPercent,
            alert: diskAlert,
          },
          alerts: {
            memory: memAlert,
            disk: diskAlert,
          },
        },
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/system/events
   * System event log with filtering and pagination.
   * Query params: ?event_type=<EventType>&severity=<Severity>&page=1&limit=50
   */
  fastify.get<{
    Querystring: {
      event_type?: string;
      severity?: string;
      page?: string;
      limit?: string;
    };
  }>(
    '/api/v1/system/events',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{
        Querystring: {
          event_type?: string;
          severity?: string;
          page?: string;
          limit?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const db = getDb();

      const page = Math.max(1, parseInt(request.query.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50', 10)));
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (request.query.event_type) {
        conditions.push('event_type = ?');
        params.push(request.query.event_type);
      }

      if (request.query.severity) {
        conditions.push('severity = ?');
        params.push(request.query.severity);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const totalRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM system_events ${whereClause}`
        )
        .get(...params) as { count: number };

      const events = db
        .prepare(
          `SELECT * FROM system_events ${whereClause}
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as SystemEvent[];

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
}
