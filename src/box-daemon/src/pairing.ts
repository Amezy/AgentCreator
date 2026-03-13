import crypto from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { signToken, hashToken, createAuthMiddleware } from './auth';
import { addPairedClient, revokePairedClient } from './db';
import { PairingSession, ErrorCode } from './types';

interface PairingOpts extends FastifyPluginOptions {
  jwtSecret: string;
  boxId: string;
  boxName: string;
  onPairingRequest?: (code: string, clientName: string) => void;
  onPairingSuccess?: (clientId: string, clientName: string) => void;
}

let activeSession: PairingSession | null = null;
let lockUntil = 0;

function generateCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function generateId(): string {
  return crypto.randomUUID();
}

/** Exported for testing only */
export const _testing = {
  getCurrentCode: () => activeSession?.code ?? '',
  reset: () => { activeSession = null; lockUntil = 0; },
};

export async function pairingRoutes(fastify: FastifyInstance, opts: PairingOpts): Promise<void> {
  const { jwtSecret, boxId, boxName, onPairingRequest, onPairingSuccess } = opts;

  fastify.post<{ Body: { clientName: string } }>('/pair/request', async (request, reply) => {
    // Validate request body
    if (!request.body || typeof request.body !== 'object') {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request body is required' });
    }

    if (Date.now() < lockUntil) {
      const waitSec = Math.ceil((lockUntil - Date.now()) / 1000);
      return reply.code(423).send({ error: ErrorCode.PAIRING_LOCKED, message: `Locked. Retry in ${waitSec}s` });
    }

    // Replace any existing active session (only one client can pair at a time anyway)
    if (activeSession && activeSession.expiresAt > Date.now()) {
      console.log(`[Pairing] Replacing active session (was for client: ${activeSession.clientName})`);
      activeSession = null;
    }

    const clientName = typeof request.body.clientName === 'string' ? request.body.clientName.slice(0, 128) : 'Unknown';
    const code = generateCode();
    const pairingId = generateId();

    activeSession = {
      pairingId,
      clientName,
      code,
      expiresAt: Date.now() + 300_000, // 5 minutes
      attempts: 0,
    };

    console.log(`[Pairing] Code: ${code} (for client: ${clientName})`);
    onPairingRequest?.(code, clientName);

    return { pairingId, expiresIn: 300 };
  });

  fastify.post<{ Body: { pairingId: string; code: string } }>('/pair/confirm', async (request, reply) => {
    if (Date.now() < lockUntil) {
      const waitSec = Math.ceil((lockUntil - Date.now()) / 1000);
      return reply.code(423).send({ error: ErrorCode.PAIRING_LOCKED, message: `Locked. Retry in ${waitSec}s` });
    }

    if (!request.body || typeof request.body !== 'object') {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request body is required' });
    }
    const { pairingId, code } = request.body;
    if (typeof pairingId !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'pairingId (string) and code (6 digits) are required' });
    }

    if (!activeSession || activeSession.pairingId !== pairingId) {
      return reply.code(400).send({ error: 'INVALID_SESSION', message: 'No matching pairing session' });
    }

    if (activeSession.expiresAt < Date.now()) {
      activeSession = null;
      return reply.code(408).send({ error: ErrorCode.PAIRING_EXPIRED, message: 'Pairing code expired' });
    }

    if (activeSession.code !== code) {
      activeSession.attempts++;
      if (activeSession.attempts >= 5) {
        lockUntil = Date.now() + 10 * 60 * 1000; // 10 min lock
        activeSession = null;
        return reply.code(423).send({ error: ErrorCode.PAIRING_LOCKED, message: 'Too many attempts. Locked for 10 minutes.' });
      }
      return reply.code(401).send({ error: 'WRONG_CODE', message: `Wrong code. ${5 - activeSession.attempts} attempts remaining.` });
    }

    // Success — generate token and persist
    const clientId = generateId();
    const token = signToken({ clientId, boxId }, jwtSecret);
    const tokenHash = hashToken(token);

    addPairedClient({ id: clientId, name: activeSession.clientName, tokenHash });
    onPairingSuccess?.(clientId, activeSession.clientName);

    activeSession = null;

    return {
      token,
      clientId,
      boxInfo: { name: boxName, id: boxId, version: '1.0.0' },
    };
  });

  // DEV ONLY: query current pairing code without checking logs
  fastify.get('/pair/debug-code', async (_request, reply) => {
    if (!activeSession || activeSession.expiresAt < Date.now()) {
      return reply.code(404).send({ error: 'NO_SESSION', message: 'No active pairing session' });
    }
    return { code: activeSession.code, expiresIn: Math.ceil((activeSession.expiresAt - Date.now()) / 1000) };
  });

  // Auth required for unpair
  const authMiddleware = createAuthMiddleware(jwtSecret);

  fastify.delete<{ Params: { clientId: string } }>('/pair/:clientId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { clientId } = request.params;
    revokePairedClient(clientId);
    return { success: true };
  });
}
