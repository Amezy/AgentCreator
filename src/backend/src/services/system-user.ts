/**
 * System User Management Service
 *
 * Creates, modifies, and deletes Linux system users via sudo commands.
 * All operations are no-ops when CONFIG.LINUX_USER_ENABLED is false.
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { CONFIG } from './config';

const execFileAsync = promisify(execFile);

interface ServiceResult {
  success: boolean;
  error?: string;
}

/**
 * Execute a command via sudo. Returns a success/error result.
 * When LINUX_USER_ENABLED is false, returns success immediately.
 */
async function sudoExec(
  args: string[],
  options?: { timeout?: number; input?: string }
): Promise<ServiceResult> {
  if (!CONFIG.LINUX_USER_ENABLED) {
    return { success: true };
  }

  const timeout = options?.timeout || CONFIG.SUDO_TIMEOUT_MS;

  try {
    if (options?.input) {
      // Use spawn for stdin piping (e.g. chpasswd)
      return new Promise<ServiceResult>((resolve) => {
        const proc = spawn('sudo', args, { timeout });
        proc.stdin.write(options.input);
        proc.stdin.end();

        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          resolve(
            code === 0
              ? { success: true }
              : { success: false, error: stderr || `Exit code: ${code}` }
          );
        });
        proc.on('error', (err: Error) => {
          resolve({ success: false, error: err.message });
        });
      });
    }

    await execFileAsync('sudo', args, { timeout });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Create a Linux system user with home directory, groups, and password.
 */
export async function createSystemUser(
  username: string,
  password: string,
  role: string
): Promise<ServiceResult> {
  // Validate username format
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]{2,31}$/.test(username)) {
    return {
      success: false,
      error: '用户名格式无效 (字母、数字、下划线、连字符, 3-32字符)',
    };
  }

  const groups =
    role === 'admin' || role === 'super_admin'
      ? `${CONFIG.USER_GROUP},${CONFIG.ADMIN_GROUP}`
      : CONFIG.USER_GROUP;

  // Check if user already exists
  const userExists = await systemUserExists(username);

  if (!userExists) {
    // Create user with home directory
    const createResult = await sudoExec([
      'useradd', '-m',
      '-G', groups,
      '-s', CONFIG.DEFAULT_SHELL,
      '-d', path.join(CONFIG.HOME_BASE, username),
      username,
    ]);
    if (!createResult.success) return createResult;
  } else {
    // User exists: ensure correct groups and shell
    await sudoExec(['usermod', '-G', groups, '-s', CONFIG.DEFAULT_SHELL, username]);
  }

  // Set password via chpasswd
  const pwResult = await sudoExec(['chpasswd'], {
    input: `${username}:${password}\n`,
  });
  if (!pwResult.success) {
    // Rollback: delete the user we just created
    await sudoExec(['userdel', '-r', username]);
    return pwResult;
  }

  // Create .ssh directory with correct permissions
  const homeDir = path.join(CONFIG.HOME_BASE, username);
  await sudoExec(['mkdir', '-p', `${homeDir}/.ssh`]);
  await sudoExec(['chmod', '700', `${homeDir}/.ssh`]);
  await sudoExec(['chown', '-R', `${username}:${username}`, `${homeDir}/.ssh`]);

  // Add CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 to user's .bashrc
  const bashrcPath = `${homeDir}/.bashrc`;
  const envLine = 'export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1';
  // Append only if not already present
  await sudoExec(['bash', '-c', `grep -qF '${envLine}' ${bashrcPath} 2>/dev/null || echo '${envLine}' >> ${bashrcPath}`]);
  await sudoExec(['chown', `${username}:${username}`, bashrcPath]);

  // Create ~/workspace directory (skip if exists)
  const workspaceDir = `${homeDir}/workspace`;
  await sudoExec(['mkdir', '-p', workspaceDir]);
  await sudoExec(['chown', `${username}:${username}`, workspaceDir]);

  return { success: true };
}

/**
 * Update a system user's password via chpasswd.
 */
export async function updateSystemPassword(
  username: string,
  password: string
): Promise<ServiceResult> {
  return sudoExec(['chpasswd'], { input: `${username}:${password}\n` });
}

/**
 * Unlock a system user account and restore shell.
 */
export async function enableSystemUser(
  username: string
): Promise<ServiceResult> {
  const r1 = await sudoExec(['usermod', '--unlock', username]);
  if (!r1.success) return r1;
  return sudoExec(['usermod', '--shell', CONFIG.DEFAULT_SHELL, username]);
}

/**
 * Lock a system user account and set shell to nologin.
 */
export async function disableSystemUser(
  username: string
): Promise<ServiceResult> {
  const r1 = await sudoExec(['usermod', '--lock', username]);
  if (!r1.success) return r1;
  return sudoExec(['usermod', '--shell', '/usr/sbin/nologin', username]);
}

/**
 * Check whether a Linux system user is currently logged in (has active sessions).
 */
export async function isUserOnline(username: string): Promise<boolean> {
  if (!CONFIG.LINUX_USER_ENABLED) return false;
  try {
    // `who` lists logged-in users; grep for matching username
    await execFileAsync('bash', ['-c', `who | grep -q "^${username} "`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a system user and their home directory.
 * Force-kills any running processes for the user first.
 */
export async function deleteSystemUser(
  username: string
): Promise<ServiceResult> {
  // Force-kill user processes first (ignore errors if no processes)
  await sudoExec(['pkill', '-9', '-u', username]);

  // Brief wait for process cleanup
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Retry force-kill in case systemd respawned user services
  await sudoExec(['pkill', '-9', '-u', username]);
  await new Promise((resolve) => setTimeout(resolve, 300));

  return sudoExec(['userdel', '-r', username]);
}

/**
 * Append an SSH public key to the user's authorized_keys file.
 */
export async function deploySSHKey(
  username: string,
  publicKey: string
): Promise<ServiceResult> {
  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const authKeysPath = `${homeDir}/.ssh/authorized_keys`;

  // Ensure .ssh directory exists
  await sudoExec(['mkdir', '-p', `${homeDir}/.ssh`]);

  // Append key using tee
  const result = await sudoExec(['tee', '-a', authKeysPath], {
    input: publicKey.trim() + '\n',
  });
  if (!result.success) return result;

  // Fix permissions
  await sudoExec(['chmod', '600', authKeysPath]);
  await sudoExec(['chown', `${username}:${username}`, authKeysPath]);

  return { success: true };
}

/**
 * Remove an SSH public key from the user's authorized_keys file.
 */
export async function removeSSHKey(
  username: string,
  publicKey: string
): Promise<ServiceResult> {
  if (!CONFIG.LINUX_USER_ENABLED) return { success: true };

  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const authKeysPath = `${homeDir}/.ssh/authorized_keys`;

  // Use sed to remove the exact line
  const escapedKey = publicKey.trim().replace(/[/\\&]/g, '\\$&');
  return sudoExec(['sed', '-i', `/${escapedKey}/d`, authKeysPath]);
}

/**
 * Check whether a Linux system user exists.
 */
export async function systemUserExists(username: string): Promise<boolean> {
  if (!CONFIG.LINUX_USER_ENABLED) return true;
  try {
    await execFileAsync('id', [username], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
