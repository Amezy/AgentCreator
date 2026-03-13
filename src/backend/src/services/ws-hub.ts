import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from '../middleware/auth';
import { JwtPayload } from '../types';
import { createChildLogger } from './logger';

const log = createChildLogger('WS-Hub');

// ==================== Types ====================

interface WsClient {
  ws: WebSocket;
  userId: number;
  username: string;
  subscribedAgents: Set<number>;
  isAlive: boolean;
}

interface WsAuthMessage {
  type: 'auth';
  token: string;
}

interface WsSubscribeMessage {
  type: 'subscribe:logs';
  agent_ids: number[];
}

interface WsUnsubscribeMessage {
  type: 'unsubscribe:logs';
  agent_ids: number[];
}

type WsIncomingMessage = WsAuthMessage | WsSubscribeMessage | WsUnsubscribeMessage;

// ==================== State ====================

const clients: Map<WebSocket, WsClient> = new Map();
const pendingAuth: Set<WebSocket> = new Set();
let wss: WebSocketServer | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const AUTH_TIMEOUT_MS = 10_000; // 10 seconds to authenticate
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds ping/pong

// ==================== Public API ====================

/**
 * Create and initialize the WebSocket hub.
 * Accepts an HTTP server instance for port sharing, or creates standalone on port 3001.
 */
export function createWsHub(server?: any): WebSocketServer {
  if (wss) {
    log.warn('WebSocketServer already created, returning existing instance');
    return wss;
  }

  if (server) {
    wss = new WebSocketServer({ server, path: '/ws' });
  } else {
    wss = new WebSocketServer({ port: 3001, path: '/ws' });
  }

  log.info('WebSocketServer initialized');

  wss.on('connection', handleConnection);

  // Start heartbeat interval
  heartbeatInterval = setInterval(checkHeartbeats, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    clients.clear();
    pendingAuth.clear();
    log.info('WebSocketServer closed');
  });

  return wss;
}

/**
 * Broadcast an event to ALL authenticated clients.
 */
export function broadcast(event: string, payload: any): void {
  const message = JSON.stringify({
    type: event,
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  });

  for (const [ws, client] of clients) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      log.error({ userId: client.userId, err }, 'Failed to broadcast');
    }
  }
}

/**
 * Broadcast an event to a specific user (all their connections).
 */
export function broadcastToUser(userId: number, event: string, payload: any): void {
  const message = JSON.stringify({
    type: event,
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  });

  for (const [ws, client] of clients) {
    if (client.userId !== userId) continue;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      log.error({ userId, err }, 'Failed to send to user');
    }
  }
}

/**
 * Broadcast an event only to clients subscribed to a specific agent.
 */
export function broadcastToAgentSubscribers(agentId: number, event: string, payload: any): void {
  const message = JSON.stringify({
    type: event,
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  });

  for (const [ws, client] of clients) {
    if (!client.subscribedAgents.has(agentId)) continue;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      log.error({ agentId, userId: client.userId, err }, 'Failed to send agent event');
    }
  }
}

/**
 * Get the number of currently authenticated connected clients.
 */
export function getConnectedClients(): number {
  return clients.size;
}

/**
 * Gracefully shut down the WebSocket hub.
 */
export function closeWsHub(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  for (const [ws] of clients) {
    try {
      ws.close(1001, 'Server shutting down');
    } catch {
      // Ignore close errors during shutdown
    }
  }
  clients.clear();
  pendingAuth.clear();

  if (wss) {
    wss.close();
    wss = null;
  }

  log.info('Hub closed');
}

// ==================== Internal Handlers ====================

function handleConnection(ws: WebSocket, req: IncomingMessage): void {
  const clientIp = req.socket.remoteAddress || 'unknown';
  log.info({ clientIp }, 'New connection, awaiting auth...');

  pendingAuth.add(ws);

  // Set auth timeout: must authenticate within AUTH_TIMEOUT_MS
  const authTimer = setTimeout(() => {
    if (pendingAuth.has(ws)) {
      log.warn({ clientIp }, 'Auth timeout, closing connection');
      sendError(ws, 'Authentication timeout');
      ws.close(4001, 'Authentication timeout');
      pendingAuth.delete(ws);
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (data) => {
    let msg: WsIncomingMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      sendError(ws, 'Invalid JSON');
      return;
    }

    // If not yet authenticated, only accept auth messages
    if (pendingAuth.has(ws)) {
      if (msg.type !== 'auth') {
        sendError(ws, 'Must authenticate first. Send { type: "auth", token: "..." }');
        return;
      }

      const authMsg = msg as WsAuthMessage;
      try {
        const decoded = verifyToken(authMsg.token);
        clearTimeout(authTimer);
        pendingAuth.delete(ws);

        const client: WsClient = {
          ws,
          userId: decoded.userId,
          username: decoded.username,
          subscribedAgents: new Set(),
          isAlive: true,
        };
        clients.set(ws, client);

        ws.send(JSON.stringify({
          type: 'auth:success',
          userId: decoded.userId,
          username: decoded.username,
          timestamp: new Date().toISOString(),
        }));

        log.info({ username: decoded.username, userId: decoded.userId }, 'User authenticated');
      } catch (err) {
        clearTimeout(authTimer);
        sendError(ws, 'Invalid or expired token');
        ws.close(4002, 'Invalid token');
        pendingAuth.delete(ws);
      }
      return;
    }

    // Authenticated client message handling
    const client = clients.get(ws);
    if (!client) return;

    switch (msg.type) {
      case 'subscribe:logs': {
        const subMsg = msg as WsSubscribeMessage;
        if (Array.isArray(subMsg.agent_ids)) {
          for (const id of subMsg.agent_ids) {
            client.subscribedAgents.add(id);
          }
          ws.send(JSON.stringify({
            type: 'subscribe:ack',
            agent_ids: Array.from(client.subscribedAgents),
            timestamp: new Date().toISOString(),
          }));
        }
        break;
      }
      case 'unsubscribe:logs': {
        const unsubMsg = msg as WsUnsubscribeMessage;
        if (Array.isArray(unsubMsg.agent_ids)) {
          for (const id of unsubMsg.agent_ids) {
            client.subscribedAgents.delete(id);
          }
          ws.send(JSON.stringify({
            type: 'unsubscribe:ack',
            agent_ids: Array.from(client.subscribedAgents),
            timestamp: new Date().toISOString(),
          }));
        }
        break;
      }
      default:
        sendError(ws, `Unknown message type: ${(msg as any).type}`);
    }
  });

  ws.on('pong', () => {
    const client = clients.get(ws);
    if (client) {
      client.isAlive = true;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    const client = clients.get(ws);
    if (client) {
      log.info({ username: client.username, userId: client.userId }, 'User disconnected');
      clients.delete(ws);
    }
    pendingAuth.delete(ws);
  });

  ws.on('error', (err) => {
    log.error({ clientIp, err }, 'WebSocket error');
    clients.delete(ws);
    pendingAuth.delete(ws);
  });
}

/**
 * Heartbeat check: ping all clients and terminate those that don't respond.
 */
function checkHeartbeats(): void {
  for (const [ws, client] of clients) {
    if (!client.isAlive) {
      log.warn({ username: client.username, userId: client.userId }, 'Heartbeat timeout, terminating');
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    client.isAlive = false;
    try {
      ws.ping();
    } catch {
      clients.delete(ws);
      ws.terminate();
    }
  }
}

/**
 * Send an error message to a WebSocket client.
 */
function sendError(ws: WebSocket, message: string): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'error',
        message,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch {
    // Ignore send errors
  }
}
