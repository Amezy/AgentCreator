import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';
import { CONFIG } from '../services/config';

const JWT_SECRET = CONFIG.JWT_SECRET;
const JWT_EXPIRES_IN = CONFIG.JWT_EXPIRES_IN;

/**
 * Generate a JWT token for the given payload.
 */
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT token.
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * Fastify preHandler hook to authenticate requests via JWT.
 * Extracts the token from the Authorization: Bearer <token> header,
 * verifies it, and attaches the decoded user info to request.user.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    reply.code(401).send({
      success: false,
      error: '缺少认证头',
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    reply.code(401).send({
      success: false,
      error: '认证头格式错误',
    });
    return;
  }

  const token = parts[1];

  try {
    const decoded = verifyToken(token);
    request.user = decoded;
  } catch (err) {
    reply.code(401).send({
      success: false,
      error: '无效或已过期的令牌',
    });
    return;
  }
}

/**
 * Fastify preHandler hook to check if the authenticated user is an admin or super_admin.
 * Must be used AFTER authMiddleware.
 */
export async function adminOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.code(401).send({
      success: false,
      error: '需要登录认证',
    });
    return;
  }

  if (request.user.role !== 'admin' && request.user.role !== 'super_admin') {
    reply.code(403).send({
      success: false,
      error: '需要管理员权限',
    });
    return;
  }
}

/**
 * Fastify preHandler hook to check if the authenticated user is a super_admin.
 * Must be used AFTER authMiddleware.
 */
export async function superAdminOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.code(401).send({
      success: false,
      error: '需要登录认证',
    });
    return;
  }

  if (request.user.role !== 'super_admin') {
    reply.code(403).send({
      success: false,
      error: '需要超级管理员权限',
    });
    return;
  }
}

/**
 * Fastify preHandler hook to authenticate daemon requests.
 * Validates that the request comes from localhost and carries a valid daemon token.
 */
export async function daemonAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const ip = request.ip;
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  if (!isLocalhost) {
    reply.code(403).send({ success: false, error: '仅允许本地访问' });
    return;
  }

  const token = request.headers['x-daemon-token'] as string;
  if (!token || !CONFIG.DAEMON_TOKEN) {
    reply.code(401).send({ success: false, error: '无效的 Daemon Token' });
    return;
  }

  // Use timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(CONFIG.DAEMON_TOKEN);
  if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    reply.code(401).send({ success: false, error: '无效的 Daemon Token' });
    return;
  }

  request.daemonAuth = true;
}
