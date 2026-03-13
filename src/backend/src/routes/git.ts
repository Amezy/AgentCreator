/**
 * Git 操作路由模块
 *
 * 提供 Git 远程仓库操作端点，支持 HTTPS + 个人访问令牌认证：
 *   - POST /api/v1/git/ls-remote - 使用 HTTPS 令牌执行 git ls-remote，
 *                                   自动尝试多种代理策略处理网络问题
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { authMiddleware } from '../middleware/auth';
import { ApiResponse } from '../types';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30000;

interface LsRemoteBody {
  repoUrl: string;
  accessToken: string;
}

/**
 * Build an HTTPS repo URL with embedded token for authentication.
 * Supports formats:
 *   https://code.iflytek.com/group/project.git
 *   code.iflytek.com/group/project.git (auto-prefix https://)
 */
function buildAuthUrl(repoUrl: string, token: string): string {
  let url = repoUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();

  // GitHub uses x-access-token for PAT authentication
  if (host === 'github.com' || host.endsWith('.github.com')) {
    parsed.username = 'x-access-token';
  } else {
    // GitLab, Gitee, and most other platforms use oauth2
    parsed.username = 'oauth2';
  }
  parsed.password = token;
  return parsed.toString();
}

/**
 * Extract hostname from a URL string safely.
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Detect the type of git error and return a user-friendly message.
 */
function classifyGitError(message: string): string {
  if (message.includes('Authentication failed') || message.includes('401')) {
    return '认证失败，请检查令牌是否正确且有 Git HTTP 权限';
  }
  if (message.includes('403') || message.includes('Write access to repository not granted')) {
    return '令牌无仓库访问权限。GitHub Fine-grained PAT 需在 Token 设置中授权目标仓库的 Contents: Read 权限';
  }
  if (message.includes('not found') || message.includes('404')) {
    return '仓库不存在，请检查地址';
  }
  if (message.includes('gnutls_handshake') || message.includes('SSL routines') || message.includes('TLS')) {
    return 'TLS 握手失败：无法与 Git 服务器建立安全连接。' +
      '可能原因：(1) VPN/代理软件未正确配置该域名的路由规则；' +
      '(2) 网络代理拦截了 HTTPS 连接；' +
      '(3) 服务器 SSL 证书或端口配置异常。' +
      '请检查 VPN/Clash 等代理工具的路由规则，确保目标域名可正常访问。';
  }
  if (message.includes('Could not resolve host') || message.includes('resolve')) {
    return 'DNS 解析失败：无法解析 Git 服务器域名。请检查网络连接和 DNS 配置。';
  }
  if (message.includes('Connection refused')) {
    return '连接被拒绝：Git 服务器未响应。请检查服务器地址和端口是否正确。';
  }
  if (message.includes('Connection timed out') || message.includes('timed out')) {
    return '连接超时：无法在规定时间内连接到 Git 服务器。请检查网络连通性。';
  }
  return message;
}

/**
 * Build git command args for ls-remote with appropriate config flags.
 */
function buildGitArgs(authUrl: string, proxyUrl?: string): string[] {
  const args = [
    '-c', 'http.sslVerify=false',
    '-c', 'http.version=HTTP/1.1',
  ];
  if (proxyUrl) {
    args.push('-c', `http.proxy=${proxyUrl}`);
    args.push('-c', `https.proxy=${proxyUrl}`);
  }
  args.push('ls-remote', '--heads', '--tags', authUrl);
  return args;
}

/**
 * Build the process environment for git commands.
 * Does NOT override proxy settings -- lets system/git config handle routing.
 */
function buildGitEnv(proxyUrl?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_SSL_NO_VERIFY: 'true',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
  }
  return env;
}

/**
 * Execute git ls-remote and return stdout on success.
 * Throws on failure with the error message.
 */
async function execGitLsRemote(
  authUrl: string,
  proxyUrl?: string,
): Promise<string> {
  const args = buildGitArgs(authUrl, proxyUrl);
  const env = buildGitEnv(proxyUrl);

  const { stdout } = await execFileAsync('git', args, {
    timeout: GIT_TIMEOUT_MS,
    env,
  });
  return stdout;
}

/**
 * Parse git ls-remote output into structured ref objects.
 */
function parseGitRefs(stdout: string): Array<{
  hash: string;
  ref: string;
  name: string;
  type: string;
}> {
  return stdout
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
}

/**
 * Detect available HTTP proxy from environment or well-known local ports.
 */
function detectProxy(): string | undefined {
  const envProxy = process.env.HTTP_PROXY
    || process.env.HTTPS_PROXY
    || process.env.http_proxy
    || process.env.https_proxy;
  return envProxy || undefined;
}

/**
 * Check if an error is a TLS/connection failure that might be resolved
 * by using a different proxy strategy.
 */
function isTlsOrConnectionError(message: string): boolean {
  return message.includes('gnutls_handshake')
    || message.includes('SSL routines')
    || message.includes('TLS')
    || message.includes('Connection refused')
    || message.includes('Connection timed out');
}

export async function gitRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/git/ls-remote
   * Run git ls-remote on a repo URL using HTTPS + personal access token.
   *
   * Strategy:
   *   1. Try with system default proxy/network settings
   *   2. If TLS fails and a proxy is available, retry through the proxy
   *   3. If TLS fails and no proxy helped, retry without any proxy (DIRECT)
   */
  fastify.post<{ Body: LsRemoteBody }>(
    '/api/v1/git/ls-remote',
    { preHandler: [authMiddleware] },
    async (
      request: FastifyRequest<{ Body: LsRemoteBody }>,
      reply: FastifyReply,
    ) => {
      const { repoUrl, accessToken } = request.body;
      if (!repoUrl?.trim()) {
        return reply.code(400).send({
          success: false,
          error: '请输入仓库地址',
        } as ApiResponse);
      }
      if (!accessToken?.trim()) {
        return reply.code(400).send({
          success: false,
          error: '请输入访问令牌',
        } as ApiResponse);
      }

      try {
        const authUrl = buildAuthUrl(repoUrl, accessToken.trim());
        const repoHost = extractHostname(authUrl);
        const envProxy = detectProxy();

        // Strategy 1: Use system defaults (inherits proxy env vars and git config)
        let stdout: string | undefined;
        let lastError = '';

        try {
          request.log.info({ repoHost }, 'git ls-remote: trying with system defaults');
          stdout = await execGitLsRemote(authUrl);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          request.log.warn({ repoHost, error: lastError }, 'git ls-remote: system defaults failed');
        }

        // Strategy 2: If failed with TLS error and proxy is available, try with explicit proxy
        if (!stdout && isTlsOrConnectionError(lastError) && envProxy) {
          try {
            request.log.info({ repoHost, proxy: envProxy }, 'git ls-remote: retrying with explicit proxy');
            stdout = await execGitLsRemote(authUrl, envProxy);
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            request.log.warn({ repoHost, error: lastError }, 'git ls-remote: proxy attempt failed');
          }
        }

        // Strategy 3: If still failed, try with no proxy at all (bypass any env proxy)
        if (!stdout && isTlsOrConnectionError(lastError)) {
          try {
            request.log.info({ repoHost }, 'git ls-remote: retrying with no proxy (DIRECT)');
            const directArgs = buildGitArgs(authUrl);
            const directEnv: NodeJS.ProcessEnv = {
              ...process.env,
              GIT_SSL_NO_VERIFY: 'true',
              GIT_TERMINAL_PROMPT: '0',
              HTTP_PROXY: '',
              HTTPS_PROXY: '',
              http_proxy: '',
              https_proxy: '',
              no_proxy: '*',
              NO_PROXY: '*',
            };
            const result = await execFileAsync('git', directArgs, {
              timeout: GIT_TIMEOUT_MS,
              env: directEnv,
            });
            stdout = result.stdout;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            request.log.warn({ repoHost, error: lastError }, 'git ls-remote: direct attempt failed');
          }
        }

        // All strategies exhausted
        if (!stdout) {
          const userMessage = classifyGitError(lastError);
          return reply.code(200).send({
            success: true,
            data: { refs: [], count: 0, error: userMessage },
          } as ApiResponse);
        }

        const refs = parseGitRefs(stdout);
        return reply.code(200).send({
          success: true,
          data: { refs, count: refs.length },
          message: `发现 ${refs.length} 个引用`,
        } as ApiResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'git ls-remote 失败';
        return reply.code(200).send({
          success: true,
          data: { refs: [], count: 0, error: classifyGitError(message) },
        } as ApiResponse);
      }
    },
  );
}
