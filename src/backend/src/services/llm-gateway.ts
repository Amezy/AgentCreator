import crypto from 'crypto';
import { getDb } from '../db/connection';
import { broadcast } from './ws-hub';
import { recordSystemEvent } from './event-logger';

// ==================== Types ====================

interface ModelRoute {
  role: string;
  preferredModel: string;
  fallbackModel: string;
}

interface QueueItem {
  id: string;
  agentId: number;
  model: string;
  prompt: string;
  timestamp: number;
  retryCount: number;
}

interface GatewayStats {
  totalRequests: number;
  queueLength: number;
  rateLimited: boolean;
  routes: ModelRoute[];
}

// ==================== Constants ====================

// MoE (Mixture of Experts) default routing strategy
const DEFAULT_ROUTES: ModelRoute[] = [
  { role: 'architect',  preferredModel: 'Opus4.6',      fallbackModel: 'Sonnet4.6' },
  { role: 'frontend',   preferredModel: 'Opus4.6',      fallbackModel: 'Sonnet4.6' },
  { role: 'backend',    preferredModel: 'Opus4.6',      fallbackModel: 'Sonnet4.6' },
  { role: 'reviewer',   preferredModel: 'Gemini3Flash',  fallbackModel: 'Sonnet4.6' },
  { role: 'devops',     preferredModel: 'Sonnet4.6',     fallbackModel: 'Gemini3Flash' },
];

// Rate limiting: sliding window
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = 60;  // Max requests per window

// Exponential backoff
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

// Queue processing interval
const QUEUE_PROCESS_INTERVAL_MS = 500; // Process queue every 500ms

// ==================== State ====================

const requestQueue: QueueItem[] = [];
const requestTimestamps: number[] = []; // Sliding window timestamps
let totalRequests = 0;
let processInterval: ReturnType<typeof setInterval> | null = null;

// ==================== Public API ====================

/**
 * Get the model route for a given agent role.
 * Returns preferred and fallback models based on MoE strategy.
 */
export function getModelRoute(role: string): ModelRoute {
  const route = DEFAULT_ROUTES.find((r) => r.role === role);
  if (route) {
    return { ...route };
  }

  // Default fallback for unknown roles
  return {
    role,
    preferredModel: 'Sonnet4.6',
    fallbackModel: 'Gemini3Flash',
  };
}

/**
 * Enqueue an LLM request. Returns the queue item ID.
 * If rate limited, the request is still queued but will be delayed.
 */
export function enqueueRequest(agentId: number, model: string, prompt: string): string {
  const id = crypto.randomUUID();
  const now = Date.now();

  const item: QueueItem = {
    id,
    agentId,
    model,
    prompt,
    timestamp: now,
    retryCount: 0,
  };

  requestQueue.push(item);
  totalRequests++;

  // Record the request timestamp for rate limiting
  requestTimestamps.push(now);

  // Check rate limiting
  if (isRateLimited()) {
    console.warn(`[LLM-Gateway] Rate limited! Queue length: ${requestQueue.length}`);

    recordSystemEvent(
      'rate_limit',
      agentId,
      'warn',
      `Rate limit triggered: ${getActiveRequestCount()} requests in window`,
      JSON.stringify({ agent_id: agentId, model, queue_length: requestQueue.length }),
      'LLM-Gateway'
    );

    broadcast('system:alert', {
      level: 'warn',
      resource: 'llm_gateway',
      type: 'rate_limit',
      message: `Rate limit triggered: ${getActiveRequestCount()} requests in 60s window`,
      queue_length: requestQueue.length,
    });
  }

  // Start queue processor if not already running
  if (!processInterval) {
    startQueueProcessor();
  }

  return id;
}

/**
 * Process the request queue. Dequeues items respecting rate limits
 * and exponential backoff.
 */
export function processQueue(): void {
  if (requestQueue.length === 0) {
    // Stop processor when queue is empty
    if (processInterval) {
      clearInterval(processInterval);
      processInterval = null;
    }
    return;
  }

  // Clean up old timestamps from sliding window
  cleanupSlidingWindow();

  // Don't process if rate limited
  if (isRateLimited()) {
    return;
  }

  // Peek at the first item
  const item = requestQueue[0];
  if (!item) return;

  // Check exponential backoff delay
  if (item.retryCount > 0) {
    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, item.retryCount), BACKOFF_MAX_MS);
    const elapsed = Date.now() - item.timestamp;
    if (elapsed < backoffMs) {
      // Not yet time to retry
      return;
    }
  }

  // Dequeue and process (mock processing)
  requestQueue.shift();

  // Mock: simulate sending to LLM API
  // In production, this would make actual API calls
  console.log(
    `[LLM-Gateway] Processing request ${item.id} for agent ${item.agentId}, model: ${item.model} (retry #${item.retryCount})`
  );

  // Record timestamp for rate limiting
  requestTimestamps.push(Date.now());

  // Broadcast processing event
  broadcast('system:alert', {
    level: 'info',
    resource: 'llm_gateway',
    type: 'request_processed',
    message: `Request ${item.id} processed for agent ${item.agentId}`,
    model: item.model,
    queue_remaining: requestQueue.length,
  });
}

/**
 * Get current gateway statistics.
 */
export function getGatewayStats(): GatewayStats {
  cleanupSlidingWindow();

  return {
    totalRequests,
    queueLength: requestQueue.length,
    rateLimited: isRateLimited(),
    routes: DEFAULT_ROUTES.map((r) => ({ ...r })),
  };
}

/**
 * Check if the gateway is currently rate limited.
 */
export function isRateLimited(): boolean {
  cleanupSlidingWindow();
  return requestTimestamps.length >= RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Retry a failed request with exponential backoff.
 * Re-enqueues the item with incremented retry count.
 */
export function retryRequest(originalId: string, agentId: number, model: string, prompt: string, retryCount: number): string {
  const id = crypto.randomUUID();

  const item: QueueItem = {
    id,
    agentId,
    model,
    prompt,
    timestamp: Date.now(),
    retryCount: retryCount + 1,
  };

  // Calculate backoff delay
  const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, item.retryCount), BACKOFF_MAX_MS);

  requestQueue.push(item);
  totalRequests++;

  console.log(
    `[LLM-Gateway] Retry #${item.retryCount} for agent ${agentId}, backoff: ${backoffMs}ms`
  );

  // Start queue processor if not already running
  if (!processInterval) {
    startQueueProcessor();
  }

  return id;
}

/**
 * Stop the queue processor. Used during shutdown.
 */
export function stopGateway(): void {
  if (processInterval) {
    clearInterval(processInterval);
    processInterval = null;
  }
  console.log('[LLM-Gateway] Gateway stopped');
}

/**
 * Get all available model routes.
 */
export function getAllRoutes(): ModelRoute[] {
  return DEFAULT_ROUTES.map((r) => ({ ...r }));
}

// ==================== Internal Functions ====================

/**
 * Start the periodic queue processor.
 */
function startQueueProcessor(): void {
  if (processInterval) return;

  processInterval = setInterval(() => {
    processQueue();
  }, QUEUE_PROCESS_INTERVAL_MS);

  console.log('[LLM-Gateway] Queue processor started');
}

/**
 * Clean up expired timestamps from the sliding window.
 */
function cleanupSlidingWindow(): void {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
}

/**
 * Get the number of requests in the current sliding window.
 */
function getActiveRequestCount(): number {
  cleanupSlidingWindow();
  return requestTimestamps.length;
}

