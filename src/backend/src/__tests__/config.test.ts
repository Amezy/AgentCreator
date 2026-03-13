/**
 * Tests for config.ts - Centralized environment configuration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CONFIG', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('default values', () => {
    it('should have correct default PORT', async () => {
      vi.stubEnv('PORT', '');
      const { CONFIG } = await import('../services/config');
      // parseInt('', 10) is NaN, fallback to '3010'
      // Actually the code does: process.env.PORT || '3010'
      // empty string is falsy, so it uses '3010'
      expect(CONFIG.PORT).toBe(3010);
    });

    it('should have correct default WS_PORT', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.WS_PORT).toBe(3011);
    });

    it('should have correct default HOST', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.HOST).toBe('0.0.0.0');
    });

    it('should have correct default JWT_SECRET', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.JWT_SECRET).toBe('dev-jwt-secret-change-in-production');
    });

    it('should have correct default JWT_EXPIRES_IN', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.JWT_EXPIRES_IN).toBe('24h');
    });

    it('should have LINUX_USER_ENABLED default to true when env not set', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.LINUX_USER_ENABLED).toBe(true);
    });

    it('should have correct default HOME_BASE', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.HOME_BASE).toBe('/home');
    });

    it('should have correct default FACTORY_USER', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.FACTORY_USER).toBe('aiboxadmin');
    });

    it('should have correct default PAM_SERVICE', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.PAM_SERVICE).toBe('login');
    });

    it('should have correct default CLAUDE_AUTH_TIMEOUT_MS', async () => {
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.CLAUDE_AUTH_TIMEOUT_MS).toBe(300000);
    });

    it('should be frozen (immutable)', async () => {
      const { CONFIG } = await import('../services/config');
      expect(Object.isFrozen(CONFIG)).toBe(true);
    });
  });

  describe('environment variable overrides', () => {
    it('should override PORT from env', async () => {
      vi.stubEnv('PORT', '4000');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.PORT).toBe(4000);
    });

    it('should override HOST from env', async () => {
      vi.stubEnv('HOST', '127.0.0.1');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.HOST).toBe('127.0.0.1');
    });

    it('should override JWT_SECRET from env', async () => {
      vi.stubEnv('JWT_SECRET', 'my-prod-secret');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.JWT_SECRET).toBe('my-prod-secret');
    });

    it('should set LINUX_USER_ENABLED to false when env is "false"', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'false');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.LINUX_USER_ENABLED).toBe(false);
    });

    it('should keep LINUX_USER_ENABLED true when env is any other value', async () => {
      vi.stubEnv('AIBOX_LINUX_USER_ENABLED', 'true');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.LINUX_USER_ENABLED).toBe(true);
    });

    it('should override DAEMON_TOKEN from env', async () => {
      vi.stubEnv('DAEMON_TOKEN', 'test-daemon-token');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.DAEMON_TOKEN).toBe('test-daemon-token');
    });

    it('should override SUDO_TIMEOUT_MS from env', async () => {
      vi.stubEnv('AIBOX_SUDO_TIMEOUT_MS', '20000');
      const { CONFIG } = await import('../services/config');
      expect(CONFIG.SUDO_TIMEOUT_MS).toBe(20000);
    });
  });
});
