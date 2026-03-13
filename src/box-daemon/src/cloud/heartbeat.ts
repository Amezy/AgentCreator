import { makeRequest, HeartbeatPayload } from './types';
import { collectAll } from './metrics';
import { countActiveManagedUsers } from './store/managed-users';

type SendFn = (data: object) => void;
type DisconnectFn = () => void;

/**
 * Heartbeat loop: sends heartbeat.ping every interval,
 * monitors for pong response, triggers reconnect on timeout.
 */
export class HeartbeatLoop {
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt: number = Date.now();
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly boxId: string,
    private readonly send: SendFn,
    private readonly onTimeout: DisconnectFn,
    private readonly interval = 30_000,  // 30s
    private readonly timeout = 90_000,   // 90s
  ) {}

  /** Start the heartbeat loop */
  start(): void {
    this.lastPongAt = Date.now();

    // Send heartbeat.ping at regular intervals
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, this.interval);

    // Check for pong timeout
    this.timeoutTimer = setInterval(() => {
      if (Date.now() - this.lastPongAt > this.timeout) {
        console.warn(`[Cloud] Heartbeat timeout (no pong for ${this.timeout}ms), triggering reconnect`);
        this.stop();
        this.onTimeout();
      }
    }, 10_000); // check every 10s

    // Send first ping immediately
    this.sendPing();
  }

  /** Stop the heartbeat loop */
  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** Called when a heartbeat.pong is received */
  receivePong(): void {
    this.lastPongAt = Date.now();
  }

  private sendPing(): void {
    const managedUsersCount = countActiveManagedUsers();
    const payload = collectAll(managedUsersCount) as unknown as HeartbeatPayload;

    const msg = makeRequest('heartbeat.ping', this.boxId, payload as unknown as Record<string, unknown>);
    this.send(msg);
  }
}
