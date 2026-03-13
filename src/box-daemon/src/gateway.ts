import { ErrorCode } from './types';

/** Per-client sliding-window rate limiter */
export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private maxRequests: number = 60,
    private windowMs: number = 60_000,
  ) {}

  check(clientId: string): boolean {
    const now = Date.now();
    const timestamps = this.windows.get(clientId) ?? [];
    const valid = timestamps.filter(t => now - t < this.windowMs);

    if (valid.length >= this.maxRequests) {
      this.windows.set(clientId, valid);
      return false;
    }

    valid.push(now);
    this.windows.set(clientId, valid);
    return true;
  }
}

/** Simple glob-based path whitelist */
export class PathWhitelist {
  constructor(private rules: Array<{ method: string; pattern: string }>) {}

  isAllowed(method: string, path: string): boolean {
    return this.rules.some(rule => {
      if (rule.method !== '*' && rule.method !== method) return false;
      return this.matchPattern(rule.pattern, path);
    });
  }

  private matchPattern(pattern: string, path: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*');
    return new RegExp(`^${regex}$`).test(path);
  }
}

/** Circuit breaker with open/half-open/closed states */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private resetTimeoutMs: number = 30_000,
  ) {}

  isOpen(): boolean {
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      this.state = 'half-open';
      return false;
    }
    return this.state === 'open';
  }

  shouldTryHalfOpen(): boolean {
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      this.state = 'half-open';
      return true;
    }
    return this.state === 'half-open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  getState(): string {
    return this.state;
  }
}

/** Default whitelist for WorkX → AIBOX proxy */
export const DEFAULT_ALLOWED_PATHS = new PathWhitelist([
  { method: 'GET', pattern: '/api/v1/teams/**' },
  { method: 'GET', pattern: '/api/v1/personas/**' },
  { method: '*', pattern: '/api/v1/conversations/**' },
  { method: 'GET', pattern: '/ws/chat/**' },
]);
