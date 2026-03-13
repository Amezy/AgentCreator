/**
 * Tests for system-user.ts - System User Management Service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing the module
vi.mock('child_process', () => {
  const mockExecFile = vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      // promisify wraps this so no callback is passed directly
      // Instead, return stdout/stderr for promisify
    }
  );
  const mockSpawn = vi.fn(() => {
    const proc = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stderr: {
        on: vi.fn((_event: string, _handler: Function) => {}),
      },
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'close') {
          // Simulate immediate success
          setTimeout(() => handler(0), 0);
        }
      }),
    };
    return proc;
  });
  return { execFile: mockExecFile, spawn: mockSpawn };
});

describe('system-user service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('when LINUX_USER_ENABLED is false', () => {
    it('should return success for createSystemUser', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('testuser', 'password123', 'programmer');
      expect(result.success).toBe(true);
    });

    it('should return success for updateSystemPassword', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { updateSystemPassword } = await import('../services/system-user');
      const result = await updateSystemPassword('testuser', 'newpass123');
      expect(result.success).toBe(true);
    });

    it('should return success for enableSystemUser', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { enableSystemUser } = await import('../services/system-user');
      const result = await enableSystemUser('testuser');
      expect(result.success).toBe(true);
    });

    it('should return success for disableSystemUser', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { disableSystemUser } = await import('../services/system-user');
      const result = await disableSystemUser('testuser');
      expect(result.success).toBe(true);
    });

    it('should return success for deleteSystemUser', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { deleteSystemUser } = await import('../services/system-user');
      const result = await deleteSystemUser('testuser');
      expect(result.success).toBe(true);
    });

    it('should return true for systemUserExists', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { systemUserExists } = await import('../services/system-user');
      const result = await systemUserExists('testuser');
      expect(result).toBe(true);
    });
  });

  describe('username validation in createSystemUser', () => {
    it('should reject usernames shorter than 3 characters', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('ab', 'password123', 'programmer');
      expect(result.success).toBe(false);
      expect(result.error).toContain('用户名格式无效');
    });

    it('should reject usernames starting with a digit', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('1user', 'password123', 'programmer');
      expect(result.success).toBe(false);
      expect(result.error).toContain('用户名格式无效');
    });

    it('should reject usernames with uppercase letters', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('TestUser', 'password123', 'programmer');
      expect(result.success).toBe(false);
      expect(result.error).toContain('用户名格式无效');
    });

    it('should reject usernames with special characters', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('test@user', 'password123', 'programmer');
      expect(result.success).toBe(false);
      expect(result.error).toContain('用户名格式无效');
    });

    it('should reject usernames longer than 32 characters', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const longName = 'a'.repeat(33);
      const result = await createSystemUser(longName, 'password123', 'programmer');
      expect(result.success).toBe(false);
      expect(result.error).toContain('用户名格式无效');
    });

    it('should accept valid usernames', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('test_user-1', 'password123', 'programmer');
      expect(result.success).toBe(true);
    });

    it('should accept usernames starting with underscore', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { createSystemUser } = await import('../services/system-user');
      const result = await createSystemUser('_sysuser', 'password123', 'programmer');
      expect(result.success).toBe(true);
    });
  });

  describe('deploySSHKey and removeSSHKey', () => {
    it('should return success for deploySSHKey when LINUX_USER_ENABLED is false', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { deploySSHKey } = await import('../services/system-user');
      const result = await deploySSHKey('testuser', 'ssh-rsa AAAA... test@host');
      expect(result.success).toBe(true);
    });

    it('should return success for removeSSHKey when LINUX_USER_ENABLED is false', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { removeSSHKey } = await import('../services/system-user');
      const result = await removeSSHKey('testuser', 'ssh-rsa AAAA... test@host');
      expect(result.success).toBe(true);
    });
  });
});
