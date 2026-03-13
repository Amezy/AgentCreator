import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { initDb, closeDb, listPairedClients } from '../src/db';
import { pairingRoutes, _testing } from '../src/pairing';

const TEST_SECRET = 'test-secret';
const TEST_BOX_ID = 'box-test-123';

describe('pairing routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    initDb(':memory:');
    app = Fastify();
    await app.register(pairingRoutes, { jwtSecret: TEST_SECRET, boxId: TEST_BOX_ID, boxName: 'TestBox' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
    _testing.reset();
  });

  it('POST /pair/request creates a pairing session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pair/request',
      payload: { clientName: 'My-WorkX' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pairingId).toBeTruthy();
    expect(body.expiresIn).toBe(300);
  });

  it('POST /pair/request rejects when session already active', async () => {
    await app.inject({ method: 'POST', url: '/pair/request', payload: { clientName: 'A' } });
    const res = await app.inject({ method: 'POST', url: '/pair/request', payload: { clientName: 'B' } });
    expect(res.statusCode).toBe(409);
  });

  it('POST /pair/confirm succeeds with correct code', async () => {
    const reqRes = await app.inject({ method: 'POST', url: '/pair/request', payload: { clientName: 'WorkX' } });
    const { pairingId } = reqRes.json();
    const code = _testing.getCurrentCode();

    const res = await app.inject({
      method: 'POST',
      url: '/pair/confirm',
      payload: { pairingId, code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.boxInfo).toBeTruthy();

    const clients = listPairedClients();
    expect(clients).toHaveLength(1);
  });

  it('POST /pair/confirm rejects wrong code', async () => {
    const reqRes = await app.inject({ method: 'POST', url: '/pair/request', payload: { clientName: 'WorkX' } });
    const { pairingId } = reqRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/pair/confirm',
      payload: { pairingId, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('locks after 5 failed attempts', async () => {
    const reqRes = await app.inject({ method: 'POST', url: '/pair/request', payload: { clientName: 'WorkX' } });
    const { pairingId } = reqRes.json();

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/pair/confirm', payload: { pairingId, code: '000000' } });
    }

    const res = await app.inject({ method: 'POST', url: '/pair/confirm', payload: { pairingId, code: '000000' } });
    expect(res.statusCode).toBe(423);
  });
});
