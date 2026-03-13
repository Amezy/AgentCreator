/**
 * Claude Code OAuth PKCE Authentication Service
 *
 * Implements the full OAuth PKCE flow to authenticate Claude Code CLI
 * for headless server environments. Manages in-memory auth sessions
 * and writes credentials to the target user's home directory.
 */
import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { writeFile, mkdir } from 'fs/promises';
import { CONFIG } from './config';
import { ClaudeAuthSession, ClaudeAuthStatus } from '../types';
import { createChildLogger } from './logger';

const log = createChildLogger('ClaudeAuth');

const execFileAsync = promisify(execFile);

// ==================== OAuth Constants ====================

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers';

// ==================== Session Store ====================

const sessions = new Map<string, ClaudeAuthSession>();

// Cleanup expired sessions every 60 seconds
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now > session.expiresAt) {
        if (session.status === 'awaiting_code' || session.status === 'exchanging') {
          session.status = 'timeout';
        }
        // Remove terminal sessions older than 10 minutes
        if (now - session.expiresAt > 600_000) {
          sessions.delete(id);
        }
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

startCleanupTimer();

// ==================== PKCE Helpers ====================

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ==================== Public API ====================

/**
 * Start a new OAuth PKCE session for a user.
 * Returns the session ID and the OAuth URL for the admin to open.
 */
export function startSession(
  userId: number,
  username: string
): { sessionId: string; oauthUrl: string } {
  const sessionId = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  const oauthUrl = `${AUTHORIZE_URL}?${params.toString()}`;

  const session: ClaudeAuthSession = {
    sessionId,
    userId,
    username,
    status: 'awaiting_code',
    codeVerifier,
    codeChallenge,
    state,
    oauthUrl,
    createdAt: Date.now(),
    expiresAt: Date.now() + CONFIG.CLAUDE_AUTH_TIMEOUT_MS,
  };

  sessions.set(sessionId, session);
  log.info({ sessionId, userId, username }, 'OAuth session started');
  return { sessionId, oauthUrl };
}

/**
 * Submit the authorization code from the OAuth callback.
 * Exchanges it for tokens and writes credentials to the user's home.
 */
export async function submitCode(
  sessionId: string,
  authorizationCode: string
): Promise<{ success: boolean; error?: string }> {
  log.info({ sessionId, codeLength: authorizationCode.length, codePreview: authorizationCode.substring(0, 20) + '...' }, 'submitCode called');

  const session = sessions.get(sessionId);
  if (!session) {
    log.warn({ sessionId }, 'Session not found');
    return { success: false, error: '会话不存在或已过期' };
  }

  if (session.status !== 'awaiting_code') {
    log.warn({ sessionId, status: session.status }, 'Invalid session status');
    return { success: false, error: `会话状态无效: ${session.status}` };
  }

  if (Date.now() > session.expiresAt) {
    session.status = 'timeout';
    log.warn({ sessionId }, 'Session expired');
    return { success: false, error: '会话已超时' };
  }

  // Parse authorization code from various input formats:
  //   1. code#state  (Claude Code CLI callback format)
  //   2. Full callback URL: https://platform.claude.com/oauth/code/callback?code=XXX&state=YYY
  //   3. Just the code
  let codePart = authorizationCode.trim();
  let stateFromInput: string | null = null;

  // Handle full URL input
  if (codePart.startsWith('http://') || codePart.startsWith('https://')) {
    try {
      const url = new URL(codePart);
      const urlCode = url.searchParams.get('code');
      const urlState = url.searchParams.get('state');
      if (urlCode) {
        codePart = urlCode;
        stateFromInput = urlState;
        log.info({ sessionId, format: 'url' }, 'Parsed code from callback URL');
      }
    } catch {
      log.warn({ sessionId }, 'Failed to parse as URL, treating as raw code');
    }
  }
  // Handle code#state format
  else if (codePart.includes('#')) {
    const hashIdx = codePart.indexOf('#');
    stateFromInput = codePart.substring(hashIdx + 1);
    codePart = codePart.substring(0, hashIdx);
    log.info({ sessionId, format: 'code#state' }, 'Parsed code#state format');
  } else {
    log.info({ sessionId, format: 'raw_code' }, 'Using raw code, no state');
  }

  // Verify state if provided
  if (stateFromInput) {
    const stateBuf = Buffer.from(stateFromInput);
    const expectedBuf = Buffer.from(session.state);
    if (stateBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(stateBuf, expectedBuf)) {
      session.status = 'failed';
      session.error = 'State 参数不匹配';
      log.warn({ sessionId }, 'State mismatch');
      return { success: false, error: 'State 参数不匹配，可能存在 CSRF 攻击' };
    }
    log.info({ sessionId }, 'State verified OK');
  }

  session.status = 'exchanging';

  try {
    // Exchange authorization code for tokens
    // Must use JSON format + include state (matching Claude Code CLI behavior)
    const tokenBody = {
      grant_type: 'authorization_code',
      code: codePart,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: session.codeVerifier,
      state: session.state,
    };

    const bodyString = JSON.stringify(tokenBody);

    log.info({
      sessionId,
      tokenUrl: TOKEN_URL,
      clientId: CLIENT_ID,
      codeLength: codePart.length,
      verifierLength: session.codeVerifier.length,
      redirectUri: REDIRECT_URI,
    }, 'Exchanging authorization code for tokens');

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': CONFIG.CLAUDE_AUTH_USER_AGENT,
      },
      body: bodyString,
    });

    if (!response.ok) {
      const errorText = await response.text();
      session.status = 'failed';
      session.error = `Token 交换失败: ${response.status} ${errorText}`;
      log.error({
        sessionId,
        httpStatus: response.status,
        errorBody: errorText,
      }, 'Token exchange failed');
      return { success: false, error: session.error };
    }

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      account?: { uuid?: string; email_address?: string };
      organization?: { uuid?: string; name?: string };
    };

    const expiresAt = Date.now() + (tokenData.expires_in * 1000);

    log.info({ sessionId, hasAccount: !!tokenData.account, hasOrg: !!tokenData.organization }, 'Token exchange successful');

    // Write credentials to the target user's home directory
    await writeCredentials(session.username, tokenData, expiresAt);

    session.status = 'success';
    log.info({ sessionId, username: session.username }, 'Credentials written successfully');
    return { success: true };
  } catch (err) {
    session.status = 'failed';
    session.error = err instanceof Error ? err.message : String(err);
    log.error({ sessionId, err }, 'submitCode failed');
    return { success: false, error: session.error };
  }
}

/**
 * Get the current status of an auth session.
 */
export function getSessionStatus(sessionId: string): ClaudeAuthSession | null {
  return sessions.get(sessionId) || null;
}

/**
 * Cancel an in-progress auth session.
 */
export function cancelSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session && (session.status === 'awaiting_code' || session.status === 'exchanging')) {
    session.status = 'cancelled';
  }
}

/**
 * Check if a user has valid Claude credentials on disk.
 */
export async function getAuthStatus(
  username: string
): Promise<{ authenticated: boolean; expiresAt?: string; email?: string }> {
  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const credPath = path.join(homeDir, '.claude', '.credentials.json');
  const configPath = path.join(homeDir, '.claude.json');

  // Check .credentials.json first (legacy / written by our system)
  try {
    const { stdout } = await execFileAsync('sudo', [
      '-u', username, 'cat', credPath,
    ], { timeout: 5000 });

    const creds = JSON.parse(stdout);
    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      return {
        authenticated: true,
        expiresAt: oauth.expiresAt
          ? new Date(oauth.expiresAt).toISOString()
          : undefined,
      };
    }
  } catch {
    // File may not exist, continue to check .claude.json
  }

  // Check .claude.json for oauthAccount (new Claude Code CLI format)
  try {
    const { stdout } = await execFileAsync('sudo', [
      '-u', username, 'cat', configPath,
    ], { timeout: 5000 });

    const config = JSON.parse(stdout);
    if (config.oauthAccount && config.oauthAccount.accountUuid) {
      return {
        authenticated: true,
        email: config.oauthAccount.emailAddress || undefined,
      };
    }
  } catch {
    // File may not exist
  }

  return { authenticated: false };
}

/**
 * Remove Claude credentials for a user (logout).
 * Cleans up all credential files and auth-related session data.
 */
export async function logout(
  username: string
): Promise<{ success: boolean; error?: string }> {
  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const claudeDir = path.join(homeDir, '.claude');
  const credPath = path.join(claudeDir, '.credentials.json');
  const configPath = path.join(homeDir, '.claude.json');
  const configPathRedundant = path.join(claudeDir, '.claude.json');
  const sessionEnvDir = path.join(claudeDir, 'session-env');

  try {
    // Remove credentials file
    await execFileAsync('sudo', ['-u', username, 'rm', '-f', credPath], {
      timeout: 5000,
    });

    // Remove session-env directory (contains cached auth tokens)
    await execFileAsync('sudo', ['rm', '-rf', sessionEnvDir], {
      timeout: 5000,
    });

    // Remove oauthAccount from ~/.claude.json (keep other settings)
    for (const cfgPath of [configPath, configPathRedundant]) {
      try {
        const { stdout } = await execFileAsync(
          'sudo', ['-u', username, 'cat', cfgPath],
          { timeout: 5000 }
        );
        const config = JSON.parse(stdout);
        delete config.oauthAccount;
        const tmpFile = path.join(os.tmpdir(), `claude-logout-${crypto.randomUUID()}.json`);
        await writeFile(tmpFile, JSON.stringify(config, null, 2), { mode: 0o600 });
        await execFileAsync('sudo', ['mv', tmpFile, cfgPath], { timeout: 5000 });
        await execFileAsync('sudo', ['chown', `${username}:${username}`, cfgPath], { timeout: 5000 });
      } catch {
        // File may not exist, skip
      }
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ==================== Internal Helpers ====================

/**
 * Write OAuth credentials and config to the target user's home directory.
 * Uses temp files + sudo mv + sudo chown for proper ownership.
 */
async function writeCredentials(
  username: string,
  tokenData: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    account?: { uuid?: string; email_address?: string };
    organization?: { uuid?: string; name?: string };
  },
  expiresAt: number
): Promise<void> {
  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const claudeDir = path.join(homeDir, '.claude');
  const credPath = path.join(claudeDir, '.credentials.json');
  const configPath = path.join(homeDir, '.claude.json');
  const configPathRedundant = path.join(claudeDir, '.claude.json');

  // Credentials file content
  const credentials = {
    claudeAiOauth: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scopes: SCOPES.split(' '),
    },
  };

  // Config file content
  const config = {
    oauthAccount: {
      accountUuid: tokenData.account?.uuid || '',
      emailAddress: tokenData.account?.email_address || '',
      organizationUuid: tokenData.organization?.uuid || '',
      organizationName: tokenData.organization?.name || '',
    },
    hasCompletedOnboarding: true,
    lastOnboardingVersion: '2.1.63',
    theme: 'dark',
  };

  // Ensure .claude directory exists
  await execFileAsync('sudo', ['mkdir', '-p', claudeDir], { timeout: 5000 });

  // Write files via temp location + sudo mv
  const tmpDir = os.tmpdir();

  const credTmp = path.join(tmpDir, `claude-cred-${crypto.randomUUID()}.json`);
  const configTmp = path.join(tmpDir, `claude-conf-${crypto.randomUUID()}.json`);
  const configTmpR = path.join(tmpDir, `claude-confr-${crypto.randomUUID()}.json`);

  await writeFile(credTmp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  await writeFile(configTmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await writeFile(configTmpR, JSON.stringify(config, null, 2), { mode: 0o600 });

  // Move files to target locations
  await execFileAsync('sudo', ['mv', credTmp, credPath], { timeout: 5000 });
  await execFileAsync('sudo', ['mv', configTmp, configPath], { timeout: 5000 });
  await execFileAsync('sudo', ['mv', configTmpR, configPathRedundant], { timeout: 5000 });

  // Fix ownership and permissions
  await execFileAsync('sudo', ['chown', `${username}:${username}`, credPath, configPath, configPathRedundant], { timeout: 5000 });
  await execFileAsync('sudo', ['chmod', '600', credPath], { timeout: 5000 });
  await execFileAsync('sudo', ['chmod', '644', configPath, configPathRedundant], { timeout: 5000 });
  await execFileAsync('sudo', ['chown', '-R', `${username}:${username}`, claudeDir], { timeout: 5000 });
}
