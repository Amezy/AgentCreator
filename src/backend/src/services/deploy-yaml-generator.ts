/**
 * Deploy YAML Generator Service
 *
 * Generates ~/.claude/deploy.yaml for programmer users by invoking
 * the generate-deploy-yaml.sh script with environment specifications.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { CONFIG } from './config';
import { recordSystemEvent } from './event-logger';
import { createChildLogger } from './logger';

const log = createChildLogger('DeployYaml');

const execFileAsync = promisify(execFile);

const GENERATE_TIMEOUT_MS = 30_000;

const UNIX_USERNAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/;

export interface DeployEnvSpec {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface GitSpec {
  repoUrl: string;
  branch: string;
  token: string;
}

interface GenerateResult {
  success: boolean;
  error?: string;
}

/**
 * Generate deploy.yaml for a user based on deployment environment specs.
 *
 * @param username - Linux username of the target user
 * @param envSpecs - Array of environment specifications
 * @param gitSpec - Optional git repository specification
 */
export async function generateDeployYaml(
  username: string,
  envSpecs: DeployEnvSpec[],
  gitSpec?: GitSpec
): Promise<GenerateResult> {
  if (!username || !UNIX_USERNAME_RE.test(username)) {
    return { success: false, error: 'Invalid username format' };
  }

  if (envSpecs.length === 0) {
    log.warn({ username }, 'No environment specs provided, skipping deploy.yaml generation');
    return { success: true };
  }

  const homeDir = path.join(CONFIG.HOME_BASE, username);
  const claudeDir = path.join(homeDir, '.claude');
  const outputFile = path.join(claudeDir, 'deploy.yaml');
  const scriptPath = path.join(CONFIG.DEPLOY_ASSETS_DIR, 'generate-deploy-yaml.sh');

  // Build -e arguments: name:host:port:user:password
  const envArgs: string[] = [];
  for (const spec of envSpecs) {
    envArgs.push('-e', `${spec.name}:${spec.host}:${spec.port}:${spec.user}:${spec.password}`);
  }

  // Build -g argument: "repo_url|branch|token"
  const gitArgs: string[] = [];
  if (gitSpec && gitSpec.repoUrl) {
    gitArgs.push('-g', `${gitSpec.repoUrl}|${gitSpec.branch}|${gitSpec.token}`);
  }

  log.info({ username, envCount: envSpecs.length, hasGit: !!gitSpec, outputFile }, 'Generating deploy.yaml');

  try {
    // Ensure ~/.claude directory exists for the user
    await execFileAsync('sudo', ['-u', username, 'mkdir', '-p', claudeDir], {
      timeout: GENERATE_TIMEOUT_MS,
    });

    // Run the script as the target user
    const { stdout, stderr } = await execFileAsync(
      'sudo',
      ['-u', username, 'bash', scriptPath, ...envArgs, ...gitArgs, '-o', outputFile],
      { timeout: GENERATE_TIMEOUT_MS }
    );

    recordSystemEvent(
      'deploy_yaml_generate',
      null,
      'info',
      `deploy.yaml generated for ${username} with ${envSpecs.length} environment(s)`,
      JSON.stringify({
        username,
        envNames: envSpecs.map((s) => s.name),
        outputFile,
        stdout: stdout.trim().slice(0, 500),
        stderr: stderr.trim().slice(0, 500),
      }),
      'DeployYaml'
    );

    log.info({ username, envCount: envSpecs.length }, 'deploy.yaml generation succeeded');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr || '';

    log.error({ username, error: message, stderr }, 'deploy.yaml generation failed');

    recordSystemEvent(
      'deploy_yaml_generate',
      null,
      'error',
      `deploy.yaml generation failed for ${username}: ${message}`,
      JSON.stringify({ username, stderr: stderr.slice(0, 500) }),
      'DeployYaml'
    );

    return { success: false, error: message };
  }
}
