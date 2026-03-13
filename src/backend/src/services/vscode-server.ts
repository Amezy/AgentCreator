/**
 * VS Code Server Service
 *
 * Manages VS Code Server + Claude Code plugin installation for programmer users.
 * Delegates to the vscode-cc-plugin-install.sh script which handles:
 *   - VS Code Server binary deployment to ~/.vscode-server/
 *   - Claude Code plugin (.vsix) installation via code-server CLI
 *
 * The script must run as root (sudo bash script.sh -u username).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { CONFIG } from './config';
import { recordSystemEvent } from './event-logger';
import { createChildLogger } from './logger';

const log = createChildLogger('VSCode');

const execFileAsync = promisify(execFile);

/** Timeout for status check sub-commands (ls, test) */
const STATUS_CHECK_TIMEOUT_MS = 5_000;

/** Valid Unix username: starts with letter or underscore, alphanumeric/dash/underscore, max 32 chars */
const UNIX_USERNAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/;

/** Track in-progress installations to prevent concurrent runs per user */
const installLocks = new Set<string>();

/** Installation progress tracking */
export type InstallProgressStatus = 'installing' | 'success' | 'failed';

interface InstallProgressEntry {
  status: InstallProgressStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const installProgress = new Map<string, InstallProgressEntry>();

interface VscodeResult {
  success: boolean;
  error?: string;
}

export interface VscodeStatus {
  installed: boolean;
  serverPath?: string;
  commitId?: string;
  extensions?: string[];
}

/**
 * Validate a Linux username to prevent shell injection.
 * Must match /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/.
 */
function validateUsername(username: string): string | null {
  if (!username || !UNIX_USERNAME_RE.test(username)) {
    return 'Invalid username format';
  }
  return null;
}

/**
 * Get the current installation progress for a user.
 * Returns null if no installation has been tracked.
 */
export function getInstallProgress(username: string): InstallProgressEntry | null {
  return installProgress.get(username) ?? null;
}

/**
 * Run the vscode-cc-plugin-install.sh script for a given user.
 * Shared implementation for install and reinstall (BE-04 dedup).
 *
 * @param username - Linux username (must pass validation)
 * @param force - If true, passes -f flag to force reinstall
 */
async function runInstallScript(
  username: string,
  force: boolean
): Promise<VscodeResult> {
  if (!CONFIG.VSCODE_ENABLED) {
    return { success: true };
  }

  const validationError = validateUsername(username);
  if (validationError) {
    return { success: false, error: `Invalid username: ${validationError}` };
  }

  // BE-02: Prevent concurrent installs for the same user
  if (installLocks.has(username)) {
    return { success: false, error: `Installation already in progress for ${username}` };
  }

  installLocks.add(username);
  installProgress.set(username, { status: 'installing', startedAt: Date.now() });
  const operation = force ? 'reinstall' : 'install';
  log.info({ username, operation }, 'Starting VS Code Server installation');

  try {
    const scriptPath = path.join(
      CONFIG.VSCODE_ASSETS_DIR,
      'vscode-cc-plugin-install.sh'
    );

    const args = ['bash', scriptPath, '-u', username];
    if (force) {
      args.push('-f');
    }

    const { stdout, stderr } = await execFileAsync('sudo', args, {
      timeout: CONFIG.VSCODE_INSTALL_TIMEOUT_MS,
    });

    // BE-03: Record success event (include stderr for diagnostics)
    recordSystemEvent(
      'vscode_install',
      null,
      'info',
      `VSCode Server ${operation} succeeded for ${username}`,
      JSON.stringify({
        username,
        force,
        stdout: stdout.trim().slice(0, 500),
        stderr: stderr.trim().slice(0, 500),
      }),
      'VSCode'
    );

    installProgress.set(username, { status: 'success', startedAt: installProgress.get(username)!.startedAt, completedAt: Date.now() });
    log.info({ username, operation }, 'VS Code Server installation succeeded');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr || '';
    log.error({ username, operation, error: message, stderr: stderr.slice(0, 500) }, 'VS Code Server installation failed');

    // BE-03: Record failure event (include stderr)
    recordSystemEvent(
      'vscode_install',
      null,
      'error',
      `VSCode Server ${operation} failed for ${username}: ${message}`,
      JSON.stringify({ username, force, stderr: stderr.slice(0, 500) }),
      'VSCode'
    );

    installProgress.set(username, { status: 'failed', startedAt: installProgress.get(username)!.startedAt, completedAt: Date.now(), error: message });
    return { success: false, error: message };
  } finally {
    installLocks.delete(username);
  }
}

/**
 * Install VS Code Server + Claude Code plugin for a given user.
 */
export async function installVSCodeServer(
  username: string
): Promise<VscodeResult> {
  return runInstallScript(username, false);
}

/**
 * Reinstall VS Code Server for a user (force mode).
 */
export async function reinstallVSCodeServer(
  username: string
): Promise<VscodeResult> {
  return runInstallScript(username, true);
}

/**
 * Check VS Code Server installation status for a given user.
 * Uses sudo to access the user's home directory since the backend process
 * may not have permission to read other users' home dirs.
 */
export async function getVSCodeServerStatus(
  username: string
): Promise<VscodeStatus> {
  const validationError = validateUsername(username);
  if (validationError) {
    return { installed: false };
  }

  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const serverDir = path.join(homeDir, '.vscode-server');

  try {
    const { stdout: dirEntries } = await execFileAsync(
      'sudo', ['-u', username, 'ls', serverDir],
      { timeout: STATUS_CHECK_TIMEOUT_MS }
    );

    const entries = dirEntries.trim().split('\n').filter(Boolean);
    let commitId: string | undefined;

    // New layout: code-{commitId} executable directly in .vscode-server/
    const codeEntry = entries.find((e) => /^code-[0-9a-f]{40}$/.test(e));
    if (codeEntry) {
      commitId = codeEntry.replace('code-', '');
      const codeBin = path.join(serverDir, codeEntry);
      try {
        await execFileAsync(
          'sudo', ['-u', username, 'test', '-x', codeBin],
          { timeout: STATUS_CHECK_TIMEOUT_MS }
        );
      } catch {
        return { installed: false, serverPath: serverDir, commitId };
      }
    } else {
      // Legacy layout: bin/{commitId}/bin/code-server
      const binDir = path.join(serverDir, 'bin');
      try {
        const { stdout: binEntries } = await execFileAsync(
          'sudo', ['-u', username, 'ls', binDir],
          { timeout: STATUS_CHECK_TIMEOUT_MS }
        );
        commitId = binEntries.trim().split('\n').find((e) => /^[0-9a-f]{40}$/.test(e));
      } catch {
        return { installed: false, serverPath: serverDir };
      }

      if (!commitId) {
        return { installed: false, serverPath: serverDir };
      }

      const codeServerBin = path.join(binDir, commitId, 'bin', 'code-server');
      try {
        await execFileAsync(
          'sudo', ['-u', username, 'test', '-x', codeServerBin],
          { timeout: STATUS_CHECK_TIMEOUT_MS }
        );
      } catch {
        return { installed: false, serverPath: serverDir, commitId };
      }
    }

    // List installed extensions
    const extDir = path.join(serverDir, 'extensions');
    let extensions: string[] = [];
    try {
      const { stdout: extEntries } = await execFileAsync(
        'sudo', ['-u', username, 'ls', extDir],
        { timeout: STATUS_CHECK_TIMEOUT_MS }
      );
      extensions = extEntries.trim().split('\n').filter(
        (e) => e && e !== 'extensions.json' && !e.startsWith('.')
      );
    } catch {
      // No extensions directory
    }

    return { installed: true, serverPath: serverDir, commitId, extensions };
  } catch {
    return { installed: false };
  }
}
