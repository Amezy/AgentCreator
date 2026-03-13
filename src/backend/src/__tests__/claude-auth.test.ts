/**
 * Tests for claude-auth.ts - Claude Code OAuth PKCE Authentication Service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock child_process and fs/promises to prevent real system calls
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('claude-auth service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('startSession', () => {
    it('should create a session and return sessionId and oauthUrl', async () => {
      const { startSession } = await import('../services/claude-auth');
      const result = startSession(1, 'testuser');

      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('oauthUrl');
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it('should generate valid OAuth URL with correct parameters', async () => {
      const { startSession } = await import('../services/claude-auth');
      const result = startSession(1, 'testuser');

      const url = new URL(result.oauthUrl);
      expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://platform.claude.com/oauth/code/callback'
      );
      expect(url.searchParams.get('scope')).toContain('user:profile');
    });

    it('should generate unique session IDs', async () => {
      const { startSession } = await import('../services/claude-auth');
      const s1 = startSession(1, 'user1');
      const s2 = startSession(2, 'user2');
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    it('should generate code_challenge that matches S256 of code_verifier', async () => {
      const { startSession, getSessionStatus } = await import('../services/claude-auth');
      const result = startSession(1, 'testuser');
      const session = getSessionStatus(result.sessionId);

      expect(session).not.toBeNull();

      // Verify PKCE: code_challenge = BASE64URL(SHA256(code_verifier))
      const expectedChallenge = crypto
        .createHash('sha256')
        .update(session!.codeVerifier, 'ascii')
        .digest('base64url');
      expect(session!.codeChallenge).toBe(expectedChallenge);
    });
  });

  describe('getSessionStatus', () => {
    it('should return null for non-existent session', async () => {
      const { getSessionStatus } = await import('../services/claude-auth');
      const session = getSessionStatus('non-existent-id');
      expect(session).toBeNull();
    });

    it('should return session with awaiting_code status after creation', async () => {
      const { startSession, getSessionStatus } = await import('../services/claude-auth');
      const { sessionId } = startSession(1, 'testuser');
      const session = getSessionStatus(sessionId);

      expect(session).not.toBeNull();
      expect(session!.status).toBe('awaiting_code');
      expect(session!.userId).toBe(1);
      expect(session!.username).toBe('testuser');
    });
  });

  describe('cancelSession', () => {
    it('should set status to cancelled for awaiting_code session', async () => {
      const { startSession, cancelSession, getSessionStatus } = await import(
        '../services/claude-auth'
      );
      const { sessionId } = startSession(1, 'testuser');

      cancelSession(sessionId);

      const session = getSessionStatus(sessionId);
      expect(session).not.toBeNull();
      expect(session!.status).toBe('cancelled');
    });

    it('should not change status for non-existent session', async () => {
      const { cancelSession, getSessionStatus } = await import('../services/claude-auth');
      // Should not throw
      cancelSession('non-existent');
      expect(getSessionStatus('non-existent')).toBeNull();
    });

    it('should not change status for already completed session', async () => {
      const { startSession, cancelSession, getSessionStatus } = await import(
        '../services/claude-auth'
      );
      const { sessionId } = startSession(1, 'testuser');

      // Manually set status to 'success' to simulate completed session
      const session = getSessionStatus(sessionId);
      if (session) {
        (session as { status: string }).status = 'success';
      }

      cancelSession(sessionId);

      const updatedSession = getSessionStatus(sessionId);
      expect(updatedSession!.status).toBe('success');
    });
  });

  describe('submitCode', () => {
    it('should return error for non-existent session', async () => {
      const { submitCode } = await import('../services/claude-auth');
      const result = await submitCode('non-existent', 'some-code');
      expect(result.success).toBe(false);
      expect(result.error).toContain('会话不存在');
    });

    it('should return error for cancelled session', async () => {
      const { startSession, cancelSession, submitCode } = await import(
        '../services/claude-auth'
      );
      const { sessionId } = startSession(1, 'testuser');
      cancelSession(sessionId);

      const result = await submitCode(sessionId, 'some-code');
      expect(result.success).toBe(false);
      expect(result.error).toContain('会话状态无效');
    });
  });

  describe('PKCE parameter generation', () => {
    it('should generate code_verifier of appropriate length', async () => {
      const { startSession, getSessionStatus } = await import('../services/claude-auth');
      const { sessionId } = startSession(1, 'testuser');
      const session = getSessionStatus(sessionId);

      // base64url of 32 random bytes = 43 chars
      expect(session!.codeVerifier.length).toBe(43);
    });

    it('should generate code_verifier with valid base64url characters', async () => {
      const { startSession, getSessionStatus } = await import('../services/claude-auth');
      const { sessionId } = startSession(1, 'testuser');
      const session = getSessionStatus(sessionId);

      // base64url charset: A-Z, a-z, 0-9, -, _
      expect(session!.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate unique state parameter', async () => {
      const { startSession, getSessionStatus } = await import('../services/claude-auth');
      const s1 = startSession(1, 'user1');
      const s2 = startSession(2, 'user2');

      const session1 = getSessionStatus(s1.sessionId);
      const session2 = getSessionStatus(s2.sessionId);

      expect(session1!.state).not.toBe(session2!.state);
    });
  });
});
