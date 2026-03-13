/**
 * CLAUDE.md Generator Service
 *
 * Generates CLAUDE.md team configuration files for programmer users
 * by invoking the generate-claude-md.sh script with role:model pairs.
 * The generated file is written to ~/.claude/CLAUDE.md for the target user.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { CONFIG } from './config';
import { recordSystemEvent } from './event-logger';
import { createChildLogger } from './logger';

const log = createChildLogger('ClaudeMd');

const execFileAsync = promisify(execFile);

/** Timeout for CLAUDE.md generation (script is fast, 30s is generous) */
const GENERATE_TIMEOUT_MS = 30_000;

/** Valid Unix username */
const UNIX_USERNAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/;

/** Map backend model_name to script short name */
const MODEL_NAME_TO_SCRIPT: Record<string, string> = {
  'claude-opus-4-6': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};

/** Default script model for non-Claude providers (gemini, gpt, etc.) */
const DEFAULT_SCRIPT_MODEL = 'sonnet';

/** All supported roles in the script */
const SUPPORTED_ROLES = ['architect', 'frontend', 'backend', 'reviewer', 'devops'];

export interface RoleModelPair {
  role: string;
  modelName: string;
}

interface GenerateResult {
  success: boolean;
  error?: string;
}

/**
 * Map a backend model_name (e.g. 'claude-opus-4-6') to the script's short name ('opus').
 * Non-Claude models (gemini, gpt, etc.) fall back to 'sonnet' so CLAUDE.md is still generated.
 */
function toScriptModel(modelName: string): string {
  return MODEL_NAME_TO_SCRIPT[modelName] ?? DEFAULT_SCRIPT_MODEL;
}

/**
 * Generate CLAUDE.md for a user based on their team role-model assignments.
 *
 * @param username - Linux username of the target user
 * @param roleModelPairs - Array of { role, modelName } from the team config
 */
export async function generateClaudeMd(
  username: string,
  roleModelPairs: RoleModelPair[]
): Promise<GenerateResult> {
  if (!username || !UNIX_USERNAME_RE.test(username)) {
    return { success: false, error: 'Invalid username format' };
  }

  // Build -r argument: filter to supported roles, map models to script names
  const pairs: string[] = [];
  for (const { role, modelName } of roleModelPairs) {
    if (!SUPPORTED_ROLES.includes(role)) continue;
    const scriptModel = toScriptModel(modelName);
    pairs.push(`${role}:${scriptModel}`);
  }

  if (pairs.length === 0) {
    log.warn({ username }, 'No supported role-model pairs, skipping CLAUDE.md generation');
    return { success: true };
  }

  const rolesArg = pairs.join(',');
  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const claudeDir = path.join(homeDir, '.claude');
  const outputFile = path.join(claudeDir, 'CLAUDE.md');
  const scriptPath = path.join(CONFIG.SUBAGENT_ASSETS_DIR, 'generate-claude-md.sh');

  log.info({ username, rolesArg, outputFile }, 'Generating CLAUDE.md');

  try {
    // Ensure ~/.claude directory exists for the user
    await execFileAsync('sudo', ['-u', username, 'mkdir', '-p', claudeDir], {
      timeout: GENERATE_TIMEOUT_MS,
    });

    // Run the script as the target user
    const { stdout, stderr } = await execFileAsync(
      'sudo',
      ['-u', username, 'bash', scriptPath, '-r', rolesArg, '-d', '-o', outputFile],
      { timeout: GENERATE_TIMEOUT_MS }
    );

    recordSystemEvent(
      'claude_md_generate',
      null,
      'info',
      `CLAUDE.md generated for ${username} with roles: ${rolesArg}`,
      JSON.stringify({
        username,
        rolesArg,
        outputFile,
        stdout: stdout.trim().slice(0, 500),
        stderr: stderr.trim().slice(0, 500),
      }),
      'ClaudeMd'
    );

    log.info({ username, rolesArg }, 'CLAUDE.md generation succeeded');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr || '';

    log.error({ username, error: message, stderr }, 'CLAUDE.md generation failed');

    recordSystemEvent(
      'claude_md_generate',
      null,
      'error',
      `CLAUDE.md generation failed for ${username}: ${message}`,
      JSON.stringify({ username, rolesArg, stderr: stderr.slice(0, 500) }),
      'ClaudeMd'
    );

    return { success: false, error: message };
  }
}
