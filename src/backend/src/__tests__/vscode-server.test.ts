/**
 * Tests for VS Code Server service and routes.
 *
 * Covers:
 * - installVSCodeServer: VSCODE_ENABLED=false skip, success, timeout, failure
 * - reinstallVSCodeServer: passes -f flag, same scenarios
 * - getVSCodeServerStatus: dir missing, binary missing, normal, permissions error
 * - Username validation (SEC-02)
 * - Concurrent install protection (BE-02)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mocks ====================

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: vi.fn((fn: unknown) => fn),
  };
});
vi.mock('../db/connection', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  })),
}));

// ==================== Service Tests ====================

describe('vscode-server service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('installVSCodeServer', () => {
    it('should skip when VSCODE_ENABLED is false', async () => {
      vi.stubEnv('AIBOX_VSCODE_ENABLED', 'false');
      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('alice');
      expect(result).toEqual({ success: true });
    });

    it('should reject invalid usernames (SEC-02)', async () => {
      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('alice; rm -rf /');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid username');
    });

    it('should reject empty username', async () => {
      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid username');
    });

    it('should reject username starting with digit', async () => {
      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('1alice');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid username');
    });

    it('should reject username longer than 32 chars', async () => {
      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('a'.repeat(33));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid username');
    });

    it('should accept valid unix usernames', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockResolvedValue({ stdout: 'Install output', stderr: '' } as never);

      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('alice');
      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'sudo',
        expect.arrayContaining(['bash', expect.stringContaining('vscode-cc-plugin-install.sh'), '-u', 'alice']),
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });

    it('should accept username with underscore prefix', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' } as never);

      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('_service');
      expect(result.success).toBe(true);
    });

    it('should return error on script failure', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockRejectedValue(new Error('Script failed with exit code 1'));

      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('alice');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Script failed');
    });

    it('should return error on timeout', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const err = new Error('TIMEOUT');
      (err as NodeJS.ErrnoException).code = 'ERR_CHILD_PROCESS_TIMEOUT';
      mockExecFile.mockRejectedValue(err);

      const { installVSCodeServer } = await import('../services/vscode-server');
      const result = await installVSCodeServer('alice');
      expect(result.success).toBe(false);
      expect(result.error).toContain('TIMEOUT');
    });
  });

  describe('reinstallVSCodeServer', () => {
    it('should skip when VSCODE_ENABLED is false', async () => {
      vi.stubEnv('AIBOX_VSCODE_ENABLED', 'false');
      const { reinstallVSCodeServer } = await import('../services/vscode-server');
      const result = await reinstallVSCodeServer('alice');
      expect(result).toEqual({ success: true });
    });

    it('should reject invalid usernames (SEC-02)', async () => {
      const { reinstallVSCodeServer } = await import('../services/vscode-server');
      const result = await reinstallVSCodeServer('$(whoami)');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid username');
    });

    it('should pass -f flag for force reinstall', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' } as never);

      const { reinstallVSCodeServer } = await import('../services/vscode-server');
      await reinstallVSCodeServer('bob');
      expect(mockExecFile).toHaveBeenCalledWith(
        'sudo',
        expect.arrayContaining(['-f']),
        expect.any(Object)
      );
    });
  });

  describe('getVSCodeServerStatus', () => {
    it('should reject invalid usernames (SEC-02)', async () => {
      const { getVSCodeServerStatus } = await import('../services/vscode-server');
      const status = await getVSCodeServerStatus('bad user!');
      expect(status.installed).toBe(false);
    });

    it('should return installed: false when server dir does not exist', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockRejectedValue(new Error('No such file'));

      const { getVSCodeServerStatus } = await import('../services/vscode-server');
      const status = await getVSCodeServerStatus('alice');
      expect(status).toEqual({ installed: false });
    });

    it('should return installed: false when no commit dir found', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      // First call: ls serverDir succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'bin\nextensions\n', stderr: '' } as never);
      // Second call: ls binDir returns no commit hash
      mockExecFile.mockResolvedValueOnce({ stdout: 'some-dir\n', stderr: '' } as never);

      const { getVSCodeServerStatus } = await import('../services/vscode-server');
      const status = await getVSCodeServerStatus('alice');
      expect(status.installed).toBe(false);
    });

    it('should return installed: true with full status', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const commitId = '072586267e68ece9a47aa43f8c108e0dcbf44622';

      // ls serverDir
      mockExecFile.mockResolvedValueOnce({ stdout: 'bin\nextensions\n', stderr: '' } as never);
      // ls binDir
      mockExecFile.mockResolvedValueOnce({ stdout: `${commitId}\n`, stderr: '' } as never);
      // test -x code-server
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' } as never);
      // ls extDir
      mockExecFile.mockResolvedValueOnce({ stdout: 'anthropic.claude-code-2.1.66\n', stderr: '' } as never);

      const { getVSCodeServerStatus } = await import('../services/vscode-server');
      const status = await getVSCodeServerStatus('alice');
      expect(status).toEqual({
        installed: true,
        serverPath: '/home/alice/.vscode-server',
        commitId,
        extensions: ['anthropic.claude-code-2.1.66'],
      });
    });

    it('should return installed: false when code-server binary missing', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const commitId = '072586267e68ece9a47aa43f8c108e0dcbf44622';

      mockExecFile.mockResolvedValueOnce({ stdout: 'bin\n', stderr: '' } as never);
      mockExecFile.mockResolvedValueOnce({ stdout: `${commitId}\n`, stderr: '' } as never);
      // test -x fails
      mockExecFile.mockRejectedValueOnce(new Error('not executable'));

      const { getVSCodeServerStatus } = await import('../services/vscode-server');
      const status = await getVSCodeServerStatus('alice');
      expect(status.installed).toBe(false);
      expect(status.commitId).toBe(commitId);
    });
  });

  describe('concurrent install protection (BE-02)', () => {
    it('should reject concurrent install for same user', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);

      // Make the first call hang
      let resolveFirst: (value: unknown) => void;
      const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
      mockExecFile.mockReturnValueOnce(firstPromise as never);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' } as never);

      const { installVSCodeServer } = await import('../services/vscode-server');

      // Start first install (will hang)
      const first = installVSCodeServer('alice');

      // Second install should be rejected
      const second = await installVSCodeServer('alice');
      expect(second.success).toBe(false);
      expect(second.error).toContain('already in progress');

      // Resolve first
      resolveFirst!({ stdout: '', stderr: '' });
      const firstResult = await first;
      expect(firstResult.success).toBe(true);
    });

    it('should allow install for different users concurrently', async () => {
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' } as never);

      const { installVSCodeServer } = await import('../services/vscode-server');
      const [r1, r2] = await Promise.all([
        installVSCodeServer('alice'),
        installVSCodeServer('bob'),
      ]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });
});
