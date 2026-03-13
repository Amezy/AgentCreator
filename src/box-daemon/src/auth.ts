import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { FastifyRequest, FastifyReply } from 'fastify';
import { getPairedClient, updateClientTokenHashWithGrace } from './db';
import { ErrorCode } from './types';

const TOKEN_EXPIRY = '90d';
const BCRYPT_ROUNDS = 10;

export interface TokenPayload {
  clientId: string;
  boxId: string;
  iat: number;
  exp: number;
}

export function signToken(
  payload: { clientId: string; boxId: string },
  secret: string,
  expiresIn: string = TOKEN_EXPIRY,
): string {
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  return jwt.verify(token, secret) as TokenPayload;
}

export function hashToken(token: string): string {
  return bcrypt.hashSync(token, BCRYPT_ROUNDS);
}

export function compareToken(token: string, hash: string): boolean {
  return bcrypt.compareSync(token, hash);
}

/**
 * Renew a token: verify old token → verify hash match in DB → sign new → update hash.
 * Old token hash is kept in `previous_token_hash` for 60s grace period.
 * Returns null if token is invalid/revoked/hash mismatch.
 */
export async function renewToken(oldToken: string, secret: string): Promise<string | null> {
  let payload: TokenPayload;
  try {
    payload = verifyToken(oldToken, secret);
  } catch {
    return null;
  }

  const client = getPairedClient(payload.clientId);
  if (!client || client.is_revoked) return null;

  // Verify the token matches the stored hash (or the previous grace-period hash)
  if (!compareToken(oldToken, client.token_hash)) {
    if (!client.previous_token_hash || !compareToken(oldToken, client.previous_token_hash)) {
      return null;
    }
  }

  const newToken = signToken({ clientId: payload.clientId, boxId: payload.boxId }, secret);
  const newHash = hashToken(newToken);

  // Keep old hash as grace-period fallback for 60s
  updateClientTokenHashWithGrace(payload.clientId, newHash, client.token_hash);

  return newToken;
}

/**
 * Fastify preHandler middleware: extract and verify Bearer token.
 * Attaches `request.clientId` on success.
 */
export function createAuthMiddleware(secret: string) {
  return async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: ErrorCode.TOKEN_INVALID, message: 'Missing Authorization header' });
    }

    const token = authHeader.slice(7);
    let payload: TokenPayload;
    try {
      payload = verifyToken(token, secret);
    } catch (err: any) {
      const code = err.name === 'TokenExpiredError' ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID;
      return reply.code(401).send({ error: code, message: err.message });
    }

    const client = getPairedClient(payload.clientId);
    if (!client) {
      return reply.code(403).send({ error: ErrorCode.TOKEN_INVALID, message: 'Client not found' });
    }
    if (client.is_revoked) {
      return reply.code(401).send({ error: ErrorCode.TOKEN_REVOKED, message: 'Token revoked' });
    }

    (request as any).clientId = payload.clientId;
  };
}
