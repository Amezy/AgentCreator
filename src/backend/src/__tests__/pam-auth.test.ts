/**
 * Tests for pam-auth.ts - PAM Authentication Service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('pamAuthenticate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('when LINUX_USER_ENABLED is false (dev mode)', () => {
    it('should return true for any credentials', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { pamAuthenticate } = await import('../services/pam-auth');
      const result = await pamAuthenticate('anyuser', 'anypassword');
      expect(result).toBe(true);
    });

    it('should return true even with empty credentials', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { pamAuthenticate } = await import('../services/pam-auth');
      const result = await pamAuthenticate('', '');
      expect(result).toBe(true);
    });
  });

  describe('when LINUX_USER_ENABLED is true and PAM module unavailable', () => {
    it('should fall back to python3 subprocess', async () => {
      // This tests the fallback path. Since 'authenticate-pam' may not be
      // installed in test env, and we set LINUX_USER_ENABLED to true,
      // it will attempt the python3 fallback which will fail.
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'true');

      // Mock child_process.execFile to simulate python3 failure
      vi.doMock('child_process', () => ({
        execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          if (cb) cb(new Error('python3 not available'));
        }),
        spawn: vi.fn(),
      }));

      // Since authenticate-pam's require will fail in test, pamAuth will be null
      // and it falls through to the python3 fallback
      const { pamAuthenticate } = await import('../services/pam-auth');
      const result = await pamAuthenticate('testuser', 'testpass');
      // The python3 fallback will fail because execFile is mocked to error
      expect(result).toBe(false);
    });
  });
});
