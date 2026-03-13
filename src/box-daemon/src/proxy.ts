import http from 'http';
import httpProxy from 'http-proxy';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { createAuthMiddleware } from './auth';
import { RateLimiter, PathWhitelist, CircuitBreaker, DEFAULT_ALLOWED_PATHS } from './gateway';
import { logAccess } from './db';
import { ErrorCode } from './types';

interface ProxyOpts extends FastifyPluginOptions {
  jwtSecret: string;
  backendUrl: string;
  rateLimiter: RateLimiter;
  circuitBreaker: CircuitBreaker;
  pathWhitelist?: PathWhitelist;
}

export async function proxyRoutes(fastify: FastifyInstance, opts: ProxyOpts): Promise<void> {
  const { jwtSecret, backendUrl, rateLimiter, circuitBreaker, pathWhitelist } = opts;
  const whitelist = pathWhitelist ?? DEFAULT_ALLOWED_PATHS;
  const authMiddleware = createAuthMiddleware(jwtSecret);

  const proxy = httpProxy.createProxyServer({ target: backendUrl, changeOrigin: true });

  proxy.on('error', (_err, _req, res) => {
    circuitBreaker.recordFailure();
    if (res && 'writeHead' in res) {
      (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'application/json' });
      (res as http.ServerResponse).end(JSON.stringify({ error: ErrorCode.BACKEND_DOWN }));
    }
  });

  fastify.all('/api/*', { preHandler: [authMiddleware] }, async (request, reply) => {
    const clientId = (request as any).clientId as string;
    const start = Date.now();

    if (!rateLimiter.check(clientId)) {
      logAccess({ clientId, method: request.method, path: request.url, status: 429, latencyMs: Date.now() - start, blockedBy: 'rate_limit' });
      return reply.code(429).send({ error: ErrorCode.RATE_LIMITED });
    }

    if (!whitelist.isAllowed(request.method, request.url)) {
      logAccess({ clientId, method: request.method, path: request.url, status: 403, latencyMs: Date.now() - start, blockedBy: 'path_whitelist' });
      return reply.code(403).send({ error: ErrorCode.PATH_BLOCKED });
    }

    if (circuitBreaker.isOpen()) {
      logAccess({ clientId, method: request.method, path: request.url, status: 503, latencyMs: Date.now() - start, blockedBy: 'circuit_breaker' });
      return reply.code(503).send({ error: ErrorCode.CIRCUIT_OPEN });
    }

    reply.hijack();
    proxy.web(request.raw, reply.raw, {}, (err) => {
      if (err) {
        circuitBreaker.recordFailure();
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(502, { 'Content-Type': 'application/json' });
          reply.raw.end(JSON.stringify({ error: ErrorCode.BACKEND_DOWN }));
        }
      } else {
        circuitBreaker.recordSuccess();
      }
      logAccess({ clientId, method: request.method, path: request.url, status: reply.raw.statusCode ?? 502, latencyMs: Date.now() - start });
    });
  });
}
