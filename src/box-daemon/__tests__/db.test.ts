import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb, addPairedClient, getPairedClient, revokePairedClient, listPairedClients, logAccess, cleanOldLogs, getPairedClientByTokenHash, updateClientTokenHashWithGrace, cleanExpiredGracePeriods } from '../src/db';

describe('db', () => {
  beforeEach(() => {
    initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  describe('paired_clients', () => {
    it('adds and retrieves a paired client', () => {
      addPairedClient({ id: 'c1', name: 'WorkX-Office', tokenHash: 'hash123' });
      const client = getPairedClient('c1');
      expect(client).toBeTruthy();
      expect(client!.name).toBe('WorkX-Office');
      expect(client!.is_revoked).toBe(0);
    });

    it('returns null for non-existent client', () => {
      expect(getPairedClient('nope')).toBeNull();
    });

    it('revokes a client', () => {
      addPairedClient({ id: 'c1', name: 'Test', tokenHash: 'hash' });
      revokePairedClient('c1');
      const client = getPairedClient('c1');
      expect(client!.is_revoked).toBe(1);
    });

    it('lists only non-revoked clients', () => {
      addPairedClient({ id: 'c1', name: 'A', tokenHash: 'h1' });
      addPairedClient({ id: 'c2', name: 'B', tokenHash: 'h2' });
      revokePairedClient('c2');
      const list = listPairedClients();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('c1');
    });

    it('getPairedClientByTokenHash finds client by previous_token_hash during grace period', () => {
      addPairedClient({ id: 'c1', name: 'Test', tokenHash: 'old-hash' });
      updateClientTokenHashWithGrace('c1', 'new-hash', 'old-hash');
      // Old hash should still work during grace period
      const byOld = getPairedClientByTokenHash('old-hash');
      expect(byOld).toBeTruthy();
      expect(byOld!.id).toBe('c1');
      // New hash should also work
      const byNew = getPairedClientByTokenHash('new-hash');
      expect(byNew).toBeTruthy();
      // After grace period expires, old hash should not work
      getDb().prepare('UPDATE paired_clients SET grace_expires_at = ? WHERE id = ?').run(Date.now() - 1000, 'c1');
      const expired = getPairedClientByTokenHash('old-hash');
      expect(expired).toBeNull();
    });

    it('getPairedClientByTokenHash finds client by token hash and excludes revoked', () => {
      addPairedClient({ id: 'c1', name: 'Active', tokenHash: 'active-hash' });
      addPairedClient({ id: 'c2', name: 'Revoked', tokenHash: 'revoked-hash' });
      revokePairedClient('c2');

      const found = getPairedClientByTokenHash('active-hash');
      expect(found).toBeTruthy();
      expect(found!.id).toBe('c1');

      const notFound = getPairedClientByTokenHash('revoked-hash');
      expect(notFound).toBeNull();

      const missing = getPairedClientByTokenHash('no-such-hash');
      expect(missing).toBeNull();
    });

    it('updateClientTokenHashWithGrace stores new hash, preserves old hash, and sets grace_expires_at', () => {
      addPairedClient({ id: 'c1', name: 'Test', tokenHash: 'old-hash' });

      const before = Date.now();
      updateClientTokenHashWithGrace('c1', 'new-hash', 'old-hash');
      const after = Date.now();

      const client = getPairedClient('c1');
      expect(client!.token_hash).toBe('new-hash');
      expect(client!.previous_token_hash).toBe('old-hash');
      expect(client!.grace_expires_at).not.toBeNull();
      expect(client!.grace_expires_at!).toBeGreaterThanOrEqual(before + 60_000);
      expect(client!.grace_expires_at!).toBeLessThanOrEqual(after + 60_000);
    });

    it('cleanExpiredGracePeriods clears previous_token_hash when grace period has elapsed', () => {
      addPairedClient({ id: 'c1', name: 'Test', tokenHash: 'new-hash' });
      updateClientTokenHashWithGrace('c1', 'new-hash', 'old-hash');

      // Manually backdate grace_expires_at to simulate expiry
      getDb().prepare('UPDATE paired_clients SET grace_expires_at = ? WHERE id = ?').run(Date.now() - 1000, 'c1');

      cleanExpiredGracePeriods();

      const client = getPairedClient('c1');
      expect(client!.previous_token_hash).toBeNull();
      expect(client!.grace_expires_at).toBeNull();
      expect(client!.token_hash).toBe('new-hash');
    });
  });

  describe('access_log', () => {
    it('logs an access entry', () => {
      logAccess({ clientId: 'c1', method: 'GET', path: '/health', status: 200, latencyMs: 5 });
    });

    it('cleans logs older than retention days', () => {
      const oldTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
      logAccess({ clientId: 'c1', method: 'GET', path: '/health', status: 200, latencyMs: 5, createdAt: oldTime });
      logAccess({ clientId: 'c1', method: 'GET', path: '/health', status: 200, latencyMs: 5 });
      const deleted = cleanOldLogs(30);
      expect(deleted).toBeGreaterThanOrEqual(1);
    });
  });
});
