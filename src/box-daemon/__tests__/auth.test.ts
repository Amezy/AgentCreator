import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signToken, verifyToken, renewToken } from '../src/auth';
import { initDb, closeDb, addPairedClient, getPairedClient } from '../src/db';
import bcrypt from 'bcryptjs';

const TEST_SECRET = 'test-jwt-secret';

describe('auth', () => {
  beforeEach(() => {
    initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  it('signs and verifies a valid token', () => {
    const token = signToken({ clientId: 'c1', boxId: 'box1' }, TEST_SECRET);
    const payload = verifyToken(token, TEST_SECRET);
    expect(payload.clientId).toBe('c1');
    expect(payload.boxId).toBe('box1');
    expect(payload.exp).toBeDefined();
  });

  it('rejects an invalid token', () => {
    expect(() => verifyToken('garbage', TEST_SECRET)).toThrow();
  });

  it('rejects an expired token', () => {
    const token = signToken({ clientId: 'c1', boxId: 'box1' }, TEST_SECRET, '0s');
    expect(() => verifyToken(token, TEST_SECRET)).toThrow();
  });

  it('renews a token and updates DB hash', async () => {
    const oldToken = signToken({ clientId: 'c1', boxId: 'box1' }, TEST_SECRET, '1d');
    const oldHash = bcrypt.hashSync(oldToken, 10);
    addPairedClient({ id: 'c1', name: 'Test', tokenHash: oldHash });

    const newToken = await renewToken(oldToken, TEST_SECRET);
    expect(newToken).toBeTruthy();

    // New token should verify
    const payload = verifyToken(newToken!, TEST_SECRET);
    expect(payload.clientId).toBe('c1');

    // DB should have updated hash
    const client = getPairedClient('c1');
    expect(bcrypt.compareSync(newToken!, client!.token_hash)).toBe(true);
  });

  it('refuses to renew a revoked token', async () => {
    const token = signToken({ clientId: 'c1', boxId: 'box1' }, TEST_SECRET);
    const hash = bcrypt.hashSync(token, 10);
    addPairedClient({ id: 'c1', name: 'Test', tokenHash: hash });

    // Revoke
    const db = (await import('../src/db')).getDb();
    db.prepare('UPDATE paired_clients SET is_revoked = 1 WHERE id = ?').run('c1');

    const newToken = await renewToken(token, TEST_SECRET);
    expect(newToken).toBeNull();
  });
});
