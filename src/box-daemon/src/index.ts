import Fastify from 'fastify';
import cors from '@fastify/cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { initDb, closeDb, cleanOldLogs, cleanExpiredGracePeriods } from './db';
import { pairingRoutes } from './pairing';
import { healthRoutes } from './health';
import { proxyRoutes } from './proxy';
import { createAuthMiddleware, renewToken } from './auth';
import { startAdvertising, stopAdvertising } from './discovery';
import { registerProcess, startAllProcesses, stopAllProcesses, getProcessStates } from './process-guard';
import { RateLimiter, CircuitBreaker } from './gateway';
import { DaemonConfig, ErrorCode } from './types';

const VERSION = '1.0.0';

function loadConfig(): DaemonConfig {
  return {
    port: parseInt(process.env.BOX_DAEMON_PORT || '3002', 10),
    host: process.env.BOX_DAEMON_HOST || '0.0.0.0',
    jwtSecret: process.env.BOX_DAEMON_JWT_SECRET || (() => { throw new Error('BOX_DAEMON_JWT_SECRET env var is required'); })(),
    boxName: process.env.BOX_NAME || 'AIBOX',
    boxId: process.env.BOX_ID || loadOrCreateBoxId(process.env.BOX_DAEMON_DB_PATH || path.join(__dirname, '..', 'data', 'daemon.db')),
    dbPath: process.env.BOX_DAEMON_DB_PATH || path.join(__dirname, '..', 'data', 'daemon.db'),
    backendUrl: process.env.BOX_BACKEND_URL || 'http://localhost:3010',
    backendWsUrl: process.env.BOX_BACKEND_WS_URL || 'ws://localhost:3011',
  };
}

/** Load boxId from a file next to DB, or generate and persist one */
function loadOrCreateBoxId(dbPath: string): string {
  const idFile = path.join(path.dirname(dbPath), 'box-id');
  try {
    if (fs.existsSync(idFile)) return fs.readFileSync(idFile, 'utf-8').trim();
  } catch {}
  const id = crypto.randomUUID();
  const dir = path.dirname(idFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(idFile, id);
  return id;
}

async function bootstrap() {
  const config = loadConfig();

  // ── 1. Database ──
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  initDb(config.dbPath);
  cleanOldLogs(30);
  console.log(`[Daemon] Database initialized at ${config.dbPath}`);

  // ── 2. Fastify ──
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.addContentTypeParser('application/json', { bodyLimit: 10 * 1024 * 1024 }, app.getDefaultJsonParser('error', 'error'));

  // ── 3. Routes ──
  const rateLimiter = new RateLimiter(60, 60_000);
  const circuitBreaker = new CircuitBreaker(5, 30_000);

  await app.register(pairingRoutes, {
    jwtSecret: config.jwtSecret,
    boxId: config.boxId,
    boxName: config.boxName,
  });

  await app.register(healthRoutes, {
    boxName: config.boxName,
    version: VERSION,
    jwtSecret: config.jwtSecret,
    getProcessStates,
  });

  // Token renewal endpoint
  const authMiddleware = createAuthMiddleware(config.jwtSecret);
  app.post('/auth/renew', { preHandler: [authMiddleware] }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    const oldToken = authHeader!.slice(7);
    const newToken = await renewToken(oldToken, config.jwtSecret);
    if (!newToken) {
      return reply.code(401).send({ error: ErrorCode.TOKEN_INVALID });
    }
    return { token: newToken };
  });

  await app.register(proxyRoutes, {
    jwtSecret: config.jwtSecret,
    backendUrl: config.backendUrl,
    rateLimiter,
    circuitBreaker,
  });

  // ── 4. Start server (with port conflict fallback) ──
  let actualPort = config.port;
  for (let attempt = 0; attempt <= 8; attempt++) {
    try {
      await app.listen({ port: actualPort, host: config.host });
      break;
    } catch (err: any) {
      if (err.code === 'EADDRINUSE' && attempt < 8) {
        actualPort = config.port + attempt + 1;
        console.warn(`[Daemon] Port ${actualPort - 1} in use, trying ${actualPort}`);
      } else {
        throw err;
      }
    }
  }
  console.log(`[Daemon] Listening on ${config.host}:${actualPort}`);

  // ── 5. mDNS ──
  startAdvertising({
    port: actualPort,
    name: config.boxName,
    boxId: config.boxId,
    version: VERSION,
  });

  // ── 6. Process guard ──
  const projectRoot = path.resolve(__dirname, '..', '..');
  registerProcess({
    name: 'backend',
    command: 'node',
    args: ['dist/server.js'],
    cwd: path.join(projectRoot, 'backend'),
    healthUrl: `http://localhost:3010/api/v1/daemon/status`,
    healthInterval: 10_000,
    maxRestarts: 3,
    restartWindow: 5 * 60 * 1000,
  });

  if (process.env.NODE_ENV === 'production') {
    startAllProcesses();
  }

  // ── 7. Periodic cleanup ──
  setInterval(() => cleanOldLogs(30), 24 * 60 * 60 * 1000);
  setInterval(() => cleanExpiredGracePeriods(), 30_000);

  // ── 8. Graceful shutdown ──
  const shutdown = async (signal: string) => {
    console.log(`[Daemon] ${signal} received, shutting down...`);
    stopAllProcesses();
    stopAdvertising();
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Daemon] Fatal:', err);
  process.exit(1);
});
