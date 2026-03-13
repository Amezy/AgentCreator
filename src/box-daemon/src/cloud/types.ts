import crypto from 'crypto';

// ── Cloud Error Codes (matches Python IntEnum) ──

export const CloudErrorCode = {
  SUCCESS: 0,
  DEVICE_NOT_AUTHORIZED: 1001,
  DEVICE_NOT_REGISTERED: 1003,
  COMMAND_FAILED: 2001,
  COMMAND_TIMEOUT: 2002,
  COMMAND_INVALID_PARAMS: 2003,
  USER_EXISTS: 3001,
  USER_NOT_FOUND: 3002,
  USERNAME_INVALID: 3003,
  INTERNAL_ERROR: 9999,
} as const;

export type CloudErrorCodeType = (typeof CloudErrorCode)[keyof typeof CloudErrorCode];

// ── Cloud Configuration ──

export interface CloudConfig {
  wsUrl: string;
  boxId: string;
  version: string;
  heartbeatInterval: number;   // ms, default 30000
  heartbeatTimeout: number;    // ms, default 90000
  commandTimeout: number;      // ms, default 30000
}

// ── Message Interfaces ──

export interface RequestMessage {
  id: string;
  type: string;
  box_id: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface ResponseMessage {
  id: string;
  type: string;
  ref_id: string;
  timestamp: number;
  code: number;
  message: string;
  payload?: Record<string, unknown>;
}

// ── Hardware Info ──

export interface HardwareInfo {
  cpu: string;
  memory_gb: number;
  disk_gb: number;
  mac_address: string;
  serial_number: string;
}

// ── Heartbeat Payload ──

export interface HeartbeatPayload {
  uptime: number;
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  load_avg: number[];
  network: {
    rx_bytes: number;
    tx_bytes: number;
  };
  processes: number;
  managed_users_count: number;
}

// ── Command Payload ──

export interface CommandPayload {
  cmd_id: string;
  cmd_type: string;
  timeout: number;
  signature: string;
  data: Record<string, unknown>;
}

// ── Factory Functions ──

export function makeRequest(type: string, boxId: string, payload?: Record<string, unknown>): RequestMessage {
  return {
    id: `msg-${crypto.randomUUID()}`,
    type,
    box_id: boxId,
    timestamp: nowUnix(),
    payload,
  };
}

export function makeResponse(
  type: string,
  refId: string,
  boxId: string,
  code: number,
  message: string,
  payload?: Record<string, unknown>,
): RequestMessage & { ref_id: string; code: number; message: string } {
  return {
    id: `msg-${crypto.randomUUID()}`,
    type,
    box_id: boxId,
    ref_id: refId,
    timestamp: nowUnix(),
    code,
    message,
    payload,
  };
}

// ── Helpers ──

/** Current time as Unix seconds */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
