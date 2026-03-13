import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter, PathWhitelist, CircuitBreaker } from '../src/gateway';

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new RateLimiter(3, 60000);
    expect(limiter.check('c1')).toBe(true);
    expect(limiter.check('c1')).toBe(true);
    expect(limiter.check('c1')).toBe(true);
  });

  it('blocks requests exceeding limit', () => {
    const limiter = new RateLimiter(2, 60000);
    limiter.check('c1');
    limiter.check('c1');
    expect(limiter.check('c1')).toBe(false);
  });

  it('tracks clients independently', () => {
    const limiter = new RateLimiter(1, 60000);
    expect(limiter.check('c1')).toBe(true);
    expect(limiter.check('c2')).toBe(true);
    expect(limiter.check('c1')).toBe(false);
  });
});

describe('PathWhitelist', () => {
  const wl = new PathWhitelist([
    { method: 'GET', pattern: '/api/v1/teams/**' },
    { method: '*', pattern: '/api/v1/conversations/**' },
    { method: 'GET', pattern: '/ws/chat/**' },
  ]);

  it('allows matching paths', () => {
    expect(wl.isAllowed('GET', '/api/v1/teams/123')).toBe(true);
    expect(wl.isAllowed('POST', '/api/v1/conversations/abc/messages')).toBe(true);
  });

  it('blocks non-matching paths', () => {
    expect(wl.isAllowed('DELETE', '/api/v1/users/1')).toBe(false);
    expect(wl.isAllowed('POST', '/api/v1/teams/123')).toBe(false);
  });
});

describe('CircuitBreaker', () => {
  it('starts closed', () => {
    const cb = new CircuitBreaker(3, 100);
    expect(cb.isOpen()).toBe(false);
  });

  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker(3, 100);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
  });

  it('resets on success', () => {
    const cb = new CircuitBreaker(3, 100);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.isOpen()).toBe(false);
  });

  it('transitions to half-open after timeout', async () => {
    const cb = new CircuitBreaker(2, 50);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
    await new Promise(r => setTimeout(r, 60));
    expect(cb.shouldTryHalfOpen()).toBe(true);
  });
});
