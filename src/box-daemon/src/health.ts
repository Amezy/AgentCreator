import os from 'os';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { verifyToken, TokenPayload } from './auth';
import { getPairedClient, updateClientLastSeen } from './db';
import { ProcessState, HealthResponsePublic, HealthResponseFull } from './types';

interface HealthOpts extends FastifyPluginOptions {
  boxName: string;
  version: string;
  jwtSecret: string;
  getProcessStates: () => ProcessState[];
}

export async function healthRoutes(fastify: FastifyInstance, opts: HealthOpts): Promise<void> {
  const { boxName, version, jwtSecret, getProcessStates } = opts;

  fastify.get('/health', async (request, reply) => {
    const publicResponse: HealthResponsePublic = {
      status: 'ok',
      version,
      name: boxName,
    };

    // Try to authenticate (optional)
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return publicResponse;
    }

    let payload: TokenPayload;
    try {
      payload = verifyToken(authHeader.slice(7), jwtSecret);
    } catch {
      return publicResponse; // Invalid token → just return public
    }

    const client = getPairedClient(payload.clientId);
    if (!client || client.is_revoked) {
      return publicResponse;
    }

    updateClientLastSeen(payload.clientId);

    const processes = getProcessStates();
    const degraded = processes.some(p => p.status !== 'running');

    const cpus = os.cpus();
    const cpuUsage = Math.round(
      cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return acc + ((total - cpu.times.idle) / total) * 100;
      }, 0) / cpus.length
    );

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

    const tokenExpiresIn = payload.exp - Math.floor(Date.now() / 1000);

    const fullResponse: HealthResponseFull = {
      status: degraded ? 'degraded' : 'ok',
      version,
      name: boxName,
      tokenExpiresIn,
      teamCount: 0,  // TODO: query from main backend
      personaCount: 0,
      cpuUsage,
      memUsage,
      processes,
    };

    return fullResponse;
  });
}
