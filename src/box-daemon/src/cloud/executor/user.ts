import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const LOCK_RETRY_DELAY = 1000; // ms (matches Python's 1.0s)
const MAX_LOCK_RETRIES = 3;

/** Validate a Linux username */
export function validateUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/**
 * Run a command with retry on lock contention.
 * Returns { stdout, stderr }. Throws on non-zero exit code after retries.
 */
async function run(cmd: string[]): Promise<{ stdout: string; stderr: string }> {
  for (let attempt = 1; attempt <= MAX_LOCK_RETRIES; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd[0], cmd.slice(1));
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: any) {
      const stderr = (err.stderr || '').toString().trim();
      // Retry only on lock-related failures
      if ((stderr.includes('cannot lock') || stderr.includes('无法锁定')) && attempt < MAX_LOCK_RETRIES) {
        await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY));
        continue;
      }
      // Preserve stderr on the error object for classification
      err.stderr = stderr;
      throw err;
    }
  }
  throw new Error('Unreachable');
}

/**
 * Set password via `sudo chpasswd -e` with stdin piping.
 * This avoids exposing the password hash in process arguments.
 */
function chpasswdSetPassword(username: string, passwordHash: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sudo', ['chpasswd', '-e'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`chpasswd failed (exit ${code}): ${stderr.trim()}`));
      }
    });

    proc.on('error', reject);

    // Write username:hash to stdin, then close
    proc.stdin.write(`${username}:${passwordHash}\n`);
    proc.stdin.end();
  });
}

export interface CreateUserResult {
  uid: number;
  username: string;
  home_dir: string;
  created_at: number;
}

/**
 * Create a Linux user:
 * 1. sudo useradd -m -s /bin/bash {username}
 * 2. sudo chpasswd -e  (via stdin: username:hash)
 * 3. sudo usermod -aG sudo {username}
 */
export async function createUser(username: string, passwordHash: string): Promise<CreateUserResult> {
  // Step 1: create user
  await run(['sudo', 'useradd', '-m', '-s', '/bin/bash', username]);

  // Step 2: set password securely via stdin
  await chpasswdSetPassword(username, passwordHash);

  // Step 3: add to sudo group (non-fatal)
  try {
    await run(['sudo', 'usermod', '-aG', 'sudo', username]);
  } catch {
    // sudo group may not exist on all systems, try wheel
    try {
      await run(['sudo', 'usermod', '-aG', 'wheel', username]);
    } catch {}
  }

  // Get uid
  const { stdout } = await run(['id', '-u', username]);
  const uid = parseInt(stdout, 10);

  return {
    uid,
    username,
    home_dir: `/home/${username}`,
    created_at: Math.floor(Date.now() / 1000),
  };
}

export interface DeleteUserResult {
  username: string;
  deleted_at: number;
}

/**
 * Delete a Linux user.
 * @param removeHome - If true, also removes the home directory (-r flag)
 */
export async function deleteUser(username: string, removeHome = false): Promise<DeleteUserResult> {
  const args = ['userdel'];
  if (removeHome) args.push('-r');
  args.push(username);
  await run(['sudo', ...args]);
  return { username, deleted_at: Math.floor(Date.now() / 1000) };
}

export interface ResetPasswordResult {
  username: string;
  updated_at: number;
}

/**
 * Reset a user's password securely via chpasswd -e with stdin.
 */
export async function resetPassword(username: string, passwordHash: string): Promise<ResetPasswordResult> {
  await chpasswdSetPassword(username, passwordHash);
  return { username, updated_at: Math.floor(Date.now() / 1000) };
}

export interface UserStatusResult {
  username: string;
  disabled_at?: number;
  enabled_at?: number;
}

/**
 * Disable a user (lock the account).
 */
export async function disableUser(username: string): Promise<UserStatusResult> {
  await run(['sudo', 'usermod', '-L', username]);
  return { username, disabled_at: Math.floor(Date.now() / 1000) };
}

/**
 * Enable a user (unlock the account).
 */
export async function enableUser(username: string): Promise<UserStatusResult> {
  await run(['sudo', 'usermod', '-U', username]);
  return { username, enabled_at: Math.floor(Date.now() / 1000) };
}
