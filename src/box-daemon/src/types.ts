/** Paired client record stored in daemon SQLite */
export interface PairedClient {
  id: string;
  name: string;
  token_hash: string;
  previous_token_hash: string | null;
  grace_expires_at: number | null;
  paired_at: number;
  last_seen: number | null;
  is_revoked: number;
}

/** Active pairing session (in-memory only) */
export interface PairingSession {
  pairingId: string;
  clientName: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

/** Process managed by the daemon */
export interface ManagedProcess {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  healthUrl?: string;
  healthInterval: number;
  maxRestarts: number;
  restartWindow: number;
}

/** Process runtime state */
export interface ProcessState {
  name: string;
  status: 'running' | 'crashed' | 'restarting' | 'stopped';
  pid?: number;
  uptime?: number;
  restartCount: number;
  lastCrash?: number;
}

/** Health response (unauthenticated) */
export interface HealthResponsePublic {
  status: 'ok' | 'degraded';
  version: string;
  name: string;
}

/** Health response (authenticated) */
export interface HealthResponseFull extends HealthResponsePublic {
  tokenExpiresIn: number;
  teamCount: number;
  personaCount: number;
  cpuUsage: number;
  memUsage: number;
  processes: ProcessState[];
}

/** Daemon error codes */
export const ErrorCode = {
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  PATH_BLOCKED: 'PATH_BLOCKED',
  PAIRING_EXPIRED: 'PAIRING_EXPIRED',
  PAIRING_LOCKED: 'PAIRING_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  BACKEND_DOWN: 'BACKEND_DOWN',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Daemon configuration */
export interface DaemonConfig {
  port: number;
  host: string;
  jwtSecret: string;
  boxName: string;
  boxId: string;
  dbPath: string;
  backendUrl: string;
  backendWsUrl: string;
}
