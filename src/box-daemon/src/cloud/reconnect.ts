/**
 * Exponential backoff + jitter reconnect strategy.
 * Matches Python reconnect.py logic exactly.
 */
export class ReconnectStrategy {
  private attempt = 0;

  constructor(
    private readonly baseDelay = 1000,    // 1s
    private readonly maxDelay = 60000,    // 60s
    private readonly jitter = 0.25,       // ±25%
  ) {}

  /** Get next delay in ms, then increment attempt counter */
  nextDelay(): number {
    const exponential = Math.min(this.baseDelay * Math.pow(2, this.attempt), this.maxDelay);
    const jitterRange = exponential * this.jitter;
    const delay = exponential + (Math.random() * 2 - 1) * jitterRange;
    this.attempt++;
    return Math.max(100, Math.round(delay)); // min 100ms (matches Python's 0.1s)
  }

  /** Reset attempt counter (call after successful connection) */
  reset(): void {
    this.attempt = 0;
  }

  /** Current attempt number */
  get attempts(): number {
    return this.attempt;
  }
}
