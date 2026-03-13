import { CloudConfig } from './types';
import { CloudConnection } from './connection';
import { startCleanupSchedule } from './cleanup';

/**
 * CloudConnector: top-level orchestrator for cloud communication.
 * Manages the WebSocket connection and periodic cleanup.
 * Only exposes start() and stop() to the daemon.
 */
export class CloudConnector {
  private connection: CloudConnection;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CloudConfig) {
    this.connection = new CloudConnection(config);
  }

  /** Start cloud connection and cleanup schedule */
  async start(): Promise<void> {
    console.log('[Cloud] Starting cloud connector...');
    this.cleanupTimer = startCleanupSchedule();
    await this.connection.start();
  }

  /** Stop cloud connection and cleanup schedule */
  async stop(): Promise<void> {
    console.log('[Cloud] Stopping cloud connector...');
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.connection.stop();
  }
}

export { CloudConfig } from './types';
