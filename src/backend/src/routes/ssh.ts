/**
 * SSH 密钥管理路由模块
 *
 * 管理系统级 SSH 密钥对，用于 Git 仓库认证，提供以下端点：
 *   - POST /api/v1/ssh/generate          - 生成 ed25519 SSH 密钥对
 *   - GET  /api/v1/ssh/public-key        - 获取当前 SSH 公钥
 *   - POST /api/v1/ssh/test-github       - 测试 GitHub SSH 连通性
 *   - POST /api/v1/ssh/ls-remote         - 使用 SSH 密钥执行 git ls-remote
 *   - GET  /api/v1/ssh/github-repos      - 列出 GitHub 仓库（gh CLI）
 *   - POST /api/v1/ssh/github-create-repo - 创建 GitHub 仓库（gh CLI）
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import os from 'os';
import { authMiddleware } from '../middleware/auth';
import { ApiResponse } from '../types';

const execFileAsync = promisify(execFile);

const SSH_DIR = path.join(os.homedir(), '.ssh');
const KEY_NAME = 'swt_ed25519';
const KEY_PATH = path.join(SSH_DIR, KEY_NAME);
const PUB_KEY_PATH = `${KEY_PATH}.pub`;

export async function sshRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/ssh/generate
   * Generate an ed25519 SSH key pair for SWT.
   */
  fastify.post(
    '/api/v1/ssh/generate',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Ensure .ssh directory exists
        await mkdir(SSH_DIR, { recursive: true, mode: 0o700 });

        // Remove existing key if present (regenerate)
        try {
          const { unlink } = await import('fs/promises');
          await unlink(KEY_PATH).catch(() => {});
          await unlink(PUB_KEY_PATH).catch(() => {});
        } catch {
          // Ignore
        }

        // Generate ed25519 key pair
        await execFileAsync('ssh-keygen', [
          '-t', 'ed25519',
          '-f', KEY_PATH,
          '-N', '',  // No passphrase
          '-C', 'superteam@aibox',
        ]);

        // Read the public key
        const publicKey = (await readFile(PUB_KEY_PATH, 'utf-8')).trim();

        // Add github.com to known_hosts if not already present
        const knownHostsPath = path.join(SSH_DIR, 'known_hosts');
        try {
          const { stdout } = await execFileAsync('ssh-keyscan', ['-t', 'ed25519,rsa', 'github.com'], { timeout: 10000 });
          const { appendFile } = await import('fs/promises');
          // Check if github.com is already in known_hosts
          let existingHosts = '';
          try {
            existingHosts = await readFile(knownHostsPath, 'utf-8');
          } catch {
            // File doesn't exist yet
          }
          if (!existingHosts.includes('github.com')) {
            await appendFile(knownHostsPath, stdout);
          }
        } catch {
          // Non-fatal: known_hosts update failed
        }

        return reply.code(200).send({
          success: true,
          data: {
            publicKey,
            keyPath: KEY_PATH,
          },
          message: 'SSH 密钥对生成成功',
        } as ApiResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate SSH key';
        return reply.code(500).send({
          success: false,
          error: message,
        } as ApiResponse);
      }
    }
  );

  /**
   * GET /api/v1/ssh/public-key
   * Return the current SWT SSH public key.
   */
  fastify.get(
    '/api/v1/ssh/public-key',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        await access(PUB_KEY_PATH, constants.R_OK);
        const publicKey = (await readFile(PUB_KEY_PATH, 'utf-8')).trim();
        return reply.code(200).send({
          success: true,
          data: { publicKey, keyPath: KEY_PATH },
        } as ApiResponse);
      } catch {
        return reply.code(404).send({
          success: false,
          error: '未找到 SSH 密钥，请先生成',
        } as ApiResponse);
      }
    }
  );

  /**
   * POST /api/v1/ssh/test-github
   * Test SSH connectivity to github.com using the SWT key.
   */
  fastify.post(
    '/api/v1/ssh/test-github',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        await access(KEY_PATH, constants.R_OK);
      } catch {
        return reply.code(400).send({
          success: false,
          error: '未找到 SSH 密钥，请先生成',
        } as ApiResponse);
      }

      try {
        // ssh -T git@github.com returns exit code 1 on success with a greeting message
        const { stderr } = await execFileAsync('ssh', [
          '-T',
          '-i', KEY_PATH,
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'ConnectTimeout=10',
          'git@github.com',
        ], { timeout: 15000 }).catch((err: { stderr?: string; code?: number }) => {
          // ssh -T git@github.com exits with code 1 even on success
          // The greeting message comes on stderr
          if (err.stderr && err.stderr.includes('successfully authenticated')) {
            return { stdout: '', stderr: err.stderr };
          }
          throw err;
        });

        const message = stderr?.trim() || '';
        const authenticated = message.includes('successfully authenticated');

        return reply.code(200).send({
          success: true,
          data: {
            connected: authenticated,
            message: authenticated
              ? message
              : 'SSH key not yet added to GitHub account',
          },
        } as ApiResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SSH test failed';
        // Check if it's a permission denied (key not added to GitHub)
        if (message.includes('Permission denied')) {
          return reply.code(200).send({
            success: true,
            data: {
              connected: false,
              message: 'Permission denied — 请确认已将公钥添加到 GitHub 账户',
            },
          } as ApiResponse);
        }
        return reply.code(500).send({
          success: false,
          error: message,
        } as ApiResponse);
      }
    }
  );

  /**
   * POST /api/v1/ssh/ls-remote
   * Run git ls-remote on a repo URL using the SWT SSH key.
   * Body: { repoUrl: string }
   */
  fastify.post<{ Body: { repoUrl: string } }>(
    '/api/v1/ssh/ls-remote',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: { repoUrl: string } }>,
      reply: FastifyReply
    ) => {
      const { repoUrl } = request.body;
      if (!repoUrl || !repoUrl.trim()) {
        return reply.code(400).send({
          success: false,
          error: 'repoUrl is required',
        } as ApiResponse);
      }

      try {
        await access(KEY_PATH, constants.R_OK);
      } catch {
        return reply.code(400).send({
          success: false,
          error: '未找到 SSH 密钥，请先生成',
        } as ApiResponse);
      }

      try {
        const { stdout } = await execFileAsync('git', [
          'ls-remote',
          '--heads',
          '--tags',
          repoUrl.trim(),
        ], {
          timeout: 30000,
          env: {
            ...process.env,
            GIT_SSH_COMMAND: `ssh -i ${KEY_PATH} -o StrictHostKeyChecking=accept-new`,
          },
        });

        // Parse ls-remote output: each line is "<hash>\t<ref>"
        const refs = stdout
          .trim()
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const [hash, ref] = line.split('\t');
            const name = ref
              .replace('refs/heads/', '')
              .replace('refs/tags/', '')
              .replace('^{}', '');
            const type = ref.startsWith('refs/heads/') ? 'branch' : 'tag';
            return { hash: hash.substring(0, 8), ref, name, type };
          });

        return reply.code(200).send({
          success: true,
          data: { refs, count: refs.length },
          message: `Found ${refs.length} refs`,
        } as ApiResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'git ls-remote failed';
        return reply.code(200).send({
          success: true,
          data: { refs: [], count: 0, error: message },
        } as ApiResponse);
      }
    }
  );

  /**
   * GET /api/v1/ssh/github-repos
   * List GitHub repositories for the authenticated user using gh CLI.
   */
  fastify.get(
    '/api/v1/ssh/github-repos',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { stdout } = await execFileAsync('gh', [
          'repo', 'list',
          '--json', 'name,description,isPrivate,url,sshUrl,defaultBranchRef,updatedAt',
          '--limit', '50',
        ], { timeout: 15000 });

        const repos = JSON.parse(stdout).map((r: {
          name: string;
          description: string | null;
          isPrivate: boolean;
          url: string;
          sshUrl: string;
          defaultBranchRef: { name: string } | null;
          updatedAt: string;
        }) => ({
          name: r.name,
          description: r.description || '',
          isPrivate: r.isPrivate,
          url: r.url,
          sshUrl: r.sshUrl,
          defaultBranch: r.defaultBranchRef?.name || 'main',
          updatedAt: r.updatedAt,
        }));

        return reply.code(200).send({
          success: true,
          data: repos,
        } as ApiResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list repos';
        return reply.code(500).send({
          success: false,
          error: message,
        } as ApiResponse);
      }
    }
  );

  /**
   * POST /api/v1/ssh/github-create-repo
   * Create a new GitHub repository using gh CLI.
   * Body: { name: string, description?: string, isPrivate?: boolean }
   */
  fastify.post<{ Body: { name: string; description?: string; isPrivate?: boolean } }>(
    '/api/v1/ssh/github-create-repo',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: { name: string; description?: string; isPrivate?: boolean } }>,
      reply: FastifyReply
    ) => {
      const { name, description, isPrivate } = request.body;
      if (!name || !name.trim()) {
        return reply.code(400).send({
          success: false,
          error: '请输入仓库名称',
        } as ApiResponse);
      }

      try {
        const args = [
          'repo', 'create', name.trim(),
          isPrivate !== false ? '--private' : '--public',
          '--confirm',
        ];
        if (description) {
          args.push('--description', description);
        }

        const { stdout, stderr } = await execFileAsync('gh', args, { timeout: 30000 });
        const output = (stdout || stderr).trim();

        // Get the created repo info
        const { stdout: repoJson } = await execFileAsync('gh', [
          'repo', 'view', name.trim(),
          '--json', 'name,description,isPrivate,url,sshUrl,defaultBranchRef',
        ], { timeout: 10000 });

        const repo = JSON.parse(repoJson);

        return reply.code(201).send({
          success: true,
          data: {
            name: repo.name,
            description: repo.description || '',
            isPrivate: repo.isPrivate,
            url: repo.url,
            sshUrl: repo.sshUrl,
            defaultBranch: repo.defaultBranchRef?.name || 'main',
            message: output,
          },
          message: '仓库创建成功',
        } as ApiResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create repo';
        return reply.code(500).send({
          success: false,
          error: message,
        } as ApiResponse);
      }
    }
  );
}
