import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { initDb, closeDb } from '../src/db';
import { healthRoutes } from '../src/health';

describe('health routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    initDb(':memory:');
    app = Fastify();
    await app.register(healthRoutes, {
      boxName: 'TestBox',
      version: '1.0.0',
      jwtSecret: 'test-secret',
      getProcessStates: () => [],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('returns public health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.0.0');
    expect(body.name).toBe('TestBox');
    expect(body.teamCount).toBeUndefined(); // no auth = no details
  });

  it('returns full health with valid auth', async () => {
    const { signToken } = await import('../src/auth');
    const token = signToken({ clientId: 'c1', boxId: 'b1' }, 'test-secret');
    const { addPairedClient } = await import('../src/db');
    const { hashToken } = await import('../src/auth');
    addPairedClient({ id: 'c1', name: 'Test', tokenHash: hashToken(token) });

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokenExpiresIn).toBeDefined();
    expect(body.processes).toBeDefined();
  });
});
