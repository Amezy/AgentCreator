/**
 * PAM Authentication Service
 *
 * Authenticates users against Linux PAM.
 * Falls back to dev-mode bypass when LINUX_USER_ENABLED is false.
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { CONFIG } from './config';

const execFileAsync = promisify(execFile);

// Try to use authenticate-pam native module
let pamAuth: ((username: string, password: string) => Promise<boolean>) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pam = require('authenticate-pam');
  pamAuth = (username: string, password: string): Promise<boolean> => {
    return new Promise((resolve) => {
      pam.authenticate(username, password, (err: Error | null) => {
        resolve(!err);
      }, { serviceName: CONFIG.PAM_SERVICE });
    });
  };
} catch {
  // Native PAM module not available; will use fallback
}

/**
 * Authenticate via `sudo -u <user> -S true` which validates the password via PAM.
 * We pipe the password to stdin. Exit code 0 = success.
 */
function sudoPasswordCheck(username: string, password: string): Promise<boolean> {
  return new Promise((resolve) => {
    // `su -c true <username>` validates password via PAM
    const proc = spawn('su', ['-c', 'true', username], {
      timeout: CONFIG.PAM_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.write(password + '\n');
    proc.stdin.end();

    proc.on('close', (code) => {
      resolve(code === 0);
    });
    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Authenticate a user via PAM.
 *
 * - If LINUX_USER_ENABLED is false (dev mode), always returns true.
 * - If the native PAM module is available, uses it directly.
 * - Otherwise, falls back to `su -c true <username>` with password on stdin.
 */
export async function pamAuthenticate(
  username: string,
  password: string
): Promise<boolean> {
  if (!CONFIG.LINUX_USER_ENABLED) {
    return true;
  }

  if (pamAuth) {
    return pamAuth(username, password);
  }

  return sudoPasswordCheck(username, password);
}
