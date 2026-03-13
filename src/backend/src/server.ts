import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { getDb, closeDb } from './db/connection';
import { closeDaemonDb } from './services/daemon-db';
import { verifyToken } from './middleware/auth';
import { CONFIG } from './services/config';
import { logger, createChildLogger } from './services/logger';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { modelRoutes } from './routes/models';
import { teamRoutes } from './routes/teams';
import { deployRoutes } from './routes/deploy';
import { repoRoutes } from './routes/repos';
import { agentRoutes } from './routes/agents';
import { systemRoutes } from './routes/system';
import { sshRoutes } from './routes/ssh';
import { gitRoutes } from './routes/git';
import { daemonRoutes } from './routes/daemon';
import { claudeAuthRoutes } from './routes/claude-auth';
import { vscodeRoutes } from './routes/vscode-server';
import { userSSHKeyRoutes } from './routes/user-ssh-keys';

const log = createChildLogger('Server');

/**
 * 应用启动入口函数
 *
 * 启动流程：
 *   1. 创建 Fastify 实例并注册 CORS 中间件
 *   2. 初始化 SQLite 数据库连接
 *   3. 注册所有 API 路由模块
 *   4. 配置前端静态文件服务和 SPA 路由回退
 *   5. 启动 HTTP 服务器监听
 *   6. 启动 WebSocket 服务器（独立端口）
 *   7. 注册优雅关闭信号处理器
 */
async function bootstrap() {
  // ---- 第1步：创建 Fastify 实例并配置 CORS ----
  const fastify = Fastify({
    loggerInstance: logger,
  });

  await fastify.register(cors, {
    origin: true, // 开发环境允许所有来源
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Daemon-Token'],
    credentials: true,
  });

  // ---- 第2步：初始化数据库 ----
  const db = getDb();
  log.info('Database initialized');

  // ---- 第3步：注册所有 API 路由 ----
  log.info('Registering API routes...');
  await fastify.register(authRoutes);
  await fastify.register(userRoutes);
  await fastify.register(modelRoutes);
  await fastify.register(teamRoutes);
  await fastify.register(deployRoutes);
  await fastify.register(repoRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(sshRoutes);
  await fastify.register(gitRoutes);
  await fastify.register(daemonRoutes);
  await fastify.register(claudeAuthRoutes);
  await fastify.register(vscodeRoutes);
  await fastify.register(userSSHKeyRoutes);
  log.info('All API routes registered');

  // ---- 第4步：配置前端静态文件和 SPA 回退 ----
  const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
  await fastify.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/',
    wildcard: false,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    return reply.sendFile('index.html');
  });

  // ---- 第5步：启动 HTTP 服务器 ----
  try {
    await fastify.listen({ port: CONFIG.PORT, host: CONFIG.HOST });
    log.info({ host: CONFIG.HOST, port: CONFIG.PORT }, 'Box System Backend started');
  } catch (err) {
    log.fatal({ err }, 'Failed to start HTTP server');
    process.exit(1);
  }

  // ---- 第6步：启动 WebSocket 服务器 ----
  const wss = new WebSocketServer({ port: CONFIG.WS_PORT });
  log.info({ port: CONFIG.WS_PORT }, 'WebSocket server started');

  wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    log.info({ clientIp }, 'WebSocket client connected');
    let authenticated = false;

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth' && msg.token) {
          try {
            const payload = verifyToken(msg.token);
            if (payload) {
              authenticated = true;
              log.info({ userId: payload.userId, clientIp }, 'WebSocket client authenticated');
              ws.send(JSON.stringify({ type: 'auth:ok', userId: payload.userId }));
            }
          } catch {
            log.warn({ clientIp }, 'WebSocket auth failed: invalid token');
            ws.send(JSON.stringify({ type: 'auth:error', message: '无效的令牌' }));
            ws.close();
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    // 30s 心跳探测
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
      log.info({ clientIp }, 'WebSocket client disconnected');
    });
  });

  // ---- 第7步：注册优雅关闭处理器 ----
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received shutdown signal, shutting down gracefully...');
    wss.close();
    closeDb();
    closeDaemonDb();
    await fastify.close();
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
