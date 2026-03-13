import WebSocket from 'ws';
import { CloudConfig, makeRequest } from './types';
import { ReconnectStrategy } from './reconnect';
import { MessageRouter } from './router';
import { HeartbeatLoop } from './heartbeat';
import { RegisterHandler } from './handlers/register';
import { CommandHandler } from './handlers/command';
import { readSerialNumber, getHardwareInfo } from './device';

/**
 * Manages the WebSocket connection to the cloud server.
 * Handles connect/disconnect, message routing, heartbeat, and auto-reconnect.
 */
export class CloudConnection {
  private ws: WebSocket | null = null;
  private reconnectStrategy = new ReconnectStrategy();
  private router = new MessageRouter();
  private heartbeat: HeartbeatLoop;
  private registerHandler = new RegisterHandler();
  private commandHandler: CommandHandler;
  private stopping = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly config: CloudConfig) {
    const sendFn = (data: object) => this.send(data);

    this.heartbeat = new HeartbeatLoop(
      config.boxId,
      sendFn,
      () => this.reconnect(),
      config.heartbeatInterval,
      config.heartbeatTimeout,
    );

    this.commandHandler = new CommandHandler(config.boxId, sendFn, config.commandTimeout);

    // Register message handlers
    this.router.on('register.response', (msg) => this.registerHandler.handle(msg));
    this.router.on('heartbeat.pong', () => this.heartbeat.receivePong());
    this.router.on('command.request', (msg) => this.commandHandler.handle(msg));
    this.router.on('disconnect', (msg) => {
      const payload = msg.payload as Record<string, unknown> | undefined;
      console.warn(`[Cloud] Received disconnect: ${payload?.reason || 'unknown'}`);
      this.reconnect();
    });
  }

  /** Start the connection loop */
  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  /** Gracefully stop the connection */
  async stop(): Promise<void> {
    this.stopping = true;
    this.heartbeat.stop();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send disconnect message before closing
      const disconnectMsg = makeRequest('disconnect', this.config.boxId, {
        reason: 'shutdown',
        message: 'Daemon shutting down',
      });
      try {
        this.ws.send(JSON.stringify(disconnectMsg));
      } catch {}
      this.ws.close(1000, 'shutdown');
    }
    this.ws = null;
  }

  /** Send a JSON message over WebSocket */
  private send(data: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const json = JSON.stringify(data);
      console.log('[Cloud] >>> SEND:', json.substring(0, 1000));
      this.ws.send(json);
    }
  }

  /** Establish WebSocket connection */
  private connect(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.stopping) { resolve(); return; }

      const url = `${this.config.wsUrl}?box_id=${encodeURIComponent(this.config.boxId)}&version=${encodeURIComponent(this.config.version)}`;
      console.log(`[Cloud] Connecting to ${this.config.wsUrl}...`);

      // WS protocol-level ping/pong to detect half-open connections
      // (matches Python: ping_interval=20, ping_timeout=10, open_timeout=10, close_timeout=5)
      const ws = new WebSocket(url, {
        handshakeTimeout: 10_000,  // open_timeout: 10s
      });

      this.ws = ws;

      ws.on('open', () => {
        console.log('[Cloud] WebSocket connected');
        this.reconnectStrategy.reset();
        this.registerHandler.reset();

        // Send registration request (pass SN to avoid redundant read)
        const sn = readSerialNumber();
        const hwInfo = getHardwareInfo(sn);
        const regMsg = makeRequest('register.request', this.config.boxId, {
          device_sn: sn,
          hardware_info: hwInfo,
          version: this.config.version,
        });
        this.send(regMsg);

        // Start heartbeat
        this.heartbeat.start();
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          this.router.dispatch(msg);
        } catch (err) {
          console.error('[Cloud] Failed to parse message:', err);
        }
      });

      // Handle WS protocol-level pong to keep alive
      ws.on('pong', () => {
        // Protocol-level pong received — connection is alive
      });

      ws.on('close', (code, reason) => {
        console.log(`[Cloud] WebSocket closed: code=${code} reason=${reason.toString()}`);
        this.heartbeat.stop();
        if (!this.stopping) {
          this.scheduleReconnect();
        }
        resolve(); // resolve even on close to not block
      });

      ws.on('error', (err) => {
        console.error('[Cloud] WebSocket error:', err.message);
        // 'close' event will follow, which handles reconnect
        resolve();
      });

      // Start WS protocol-level ping every 20s (matches Python ping_interval=20)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 20_000);

      ws.on('close', () => {
        clearInterval(pingInterval);
      });
    });
  }

  /** Schedule a reconnect with exponential backoff */
  private scheduleReconnect(): void {
    if (this.stopping) return;

    const delay = this.reconnectStrategy.nextDelay();
    console.log(`[Cloud] Reconnecting in ${delay}ms (attempt ${this.reconnectStrategy.attempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Trigger an immediate reconnect (e.g., from heartbeat timeout) */
  private reconnect(): void {
    if (this.stopping) return;

    this.heartbeat.stop();

    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    this.scheduleReconnect();
  }
}
