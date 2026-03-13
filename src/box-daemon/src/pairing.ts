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
    if (Date.now() < lockUntil) {
      const waitSec = Math.ceil((lockUntil - Date.now()) / 1000);
      return reply.code(423).send({ error: ErrorCode.PAIRING_LOCKED, message: `Locked. Retry in ${waitSec}s` });
    }

    if (activeSession && activeSession.expiresAt > Date.now()) {
      return reply.code(409).send({ error: 'PAIRING_ACTIVE', message: 'A pairing session is already active' });
    }

    const clientName = request.body?.clientName || 'Unknown';
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

    const { pairingId, code } = request.body ?? {};

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

  // Auth required for unpair
  const authMiddleware = createAuthMiddleware(jwtSecret);

  fastify.delete<{ Params: { clientId: string } }>('/pair/:clientId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { clientId } = request.params;
    revokePairedClient(clientId);
    return { success: true };
  });
}
