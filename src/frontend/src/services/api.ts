/**
 * @module api
 * @description 前端 API 服务层。
 * 封装 fetch 请求，自动附加 JWT Authorization 请求头，
 * 统一处理 ApiEnvelope 响应格式和错误。
 * 提供所有后端接口的类型化函数，涵盖：
 * - 认证（登录）
 * - 用户 CRUD
 * - 模型 CRUD 与验证
 * - 团队 CRUD
 * - 部署配置 CRUD
 * - Git 仓库 CRUD 与连接测试
 * - VS Code Server 管理
 * - Claude OAuth 认证流程
 * - SSH 密钥管理
 */

const BASE_URL = '/api/v1';

/** 从 localStorage 获取 JWT 令牌 */
function getAuthToken(): string | null {
  return localStorage.getItem('jwt_token');
}

/** 后端统一响应信封格式 */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * 通用请求函数，自动处理 JWT 认证、请求头和响应解包
 * @param url - 相对于 BASE_URL 的路径
 * @param options - fetch 请求选项
 * @returns 解包后的响应数据
 * @throws 请求失败时抛出包含错误信息的 Error
 */
async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Only set Content-Type for requests with a body
  if (method !== 'GET' && method !== 'DELETE') {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json() as ApiEnvelope<unknown>;
      errorMsg = errorData.error || errorData.message || errorMsg;
    } catch { /* response not JSON, use default */ }
    throw new Error(errorMsg);
  }

  // DELETE may return empty body
  const text = await response.text();
  if (!text) return undefined as T;

  const envelope = JSON.parse(text) as ApiEnvelope<T>;
  if (!envelope.success) {
    throw new Error(envelope.error || envelope.message || 'Request failed');
  }
  return envelope.data as T;
}

// ----- 认证 -----

interface LoginResponse {
  token: string;
  user: { id: string; username: string; role: string; box_id: number | null };
}

/** 用户登录，返回 JWT 令牌和用户信息 */
export async function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

// ----- 用户管理 -----

interface CreateUserPayload {
  username: string;
  password: string;
  role?: 'super_admin' | 'admin' | 'programmer';
}

interface UserResponse {
  id: string;
  username: string;
  role: string;
}

/** 创建新用户 */
export async function createUser(data: CreateUserPayload): Promise<UserResponse> {
  return request<UserResponse>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 确保用户存在（不存在则创建，已存在则返回） */
export async function ensureUser(data: CreateUserPayload): Promise<UserResponse> {
  return request<UserResponse>('/users/ensure', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ----- 模型管理 -----

interface CreateModelPayload {
  provider: string;
  model_name: string;
  api_key?: string;
  is_verified?: boolean;
  user_id?: number;
}

interface ModelResponse {
  id: number;
  provider: string;
  model_name: string;
  is_verified: number;
  auth_string?: string;
}

/** 创建模型配置 */
export async function createModel(data: CreateModelPayload): Promise<ModelResponse> {
  return request<ModelResponse>('/models', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 获取模型列表，可按用户 ID 过滤 */
export async function getModels(userId?: number): Promise<ModelResponse[]> {
  const path = userId ? `/models?user_id=${userId}` : '/models';
  return request<ModelResponse[]>(path, {
    method: 'GET',
  });
}

interface VerifyModelResponse {
  id: number;
  provider: string;
  model_name: string;
  is_verified: number;
  message?: string;
}

/** 验证指定模型的可用性 */
export async function verifyModel(modelId: number): Promise<VerifyModelResponse> {
  return request<VerifyModelResponse>(`/models/${modelId}/verify`, {
    method: 'POST',
  });
}

// ----- 团队/Agent 管理 -----

interface SaveTeamPayload {
  config_name?: string;
  user_id?: number;
  architect_model_id?: number | null;
  frontend_model_id?: number | null;
  backend_model_id?: number | null;
  reviewer_model_id?: number | null;
  devops_model_id?: number | null;
  agents: {
    role: string;
    count: number;
    superpowersPrompt: string;
  }[];
}

interface TeamResponse {
  id: string;
  agents: SaveTeamPayload['agents'];
}

/** 保存团队配置（向导流程使用） */
export async function saveTeamConfig(data: SaveTeamPayload): Promise<TeamResponse> {
  return request<TeamResponse>('/teams', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 获取当前团队配置 */
export async function getTeamConfig(): Promise<TeamResponse> {
  return request<TeamResponse>('/teams', {
    method: 'GET',
  });
}

// ----- 部署管理 -----

interface TestConnectionPayload {
  serverIp: string;
  port: string;
  username: string;
  password?: string;
  sshKey?: string;
}

interface TestConnectionResponse {
  connected: boolean;
  message?: string;
}

/** 测试部署服务器连通性 */
export async function testDeployConnection(
  data: TestConnectionPayload
): Promise<TestConnectionResponse> {
  return request<TestConnectionResponse>('/deploy/test-connection', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

interface SaveDeployPayload {
  deployType: string;
  serverIp?: string;
  port?: string;
  aliAccount?: string;
  aliPassword?: string;
  user_id?: number;
  gitRepoUrl?: string;
  gitBranch?: string;
  gitToken?: string;
}

interface DeployResponse {
  id: string;
  deployType: string;
}

/** 保存部署配置，自动映射前端字段名到后端字段名 */
export async function saveDeployConfig(data: SaveDeployPayload): Promise<DeployResponse> {
  // Map frontend field names to backend field names
  const backendPayload: Record<string, unknown> = {
    deployType: data.deployType,
    serverIp: data.serverIp,
    port: data.port,
    username: data.aliAccount,
    password: data.aliPassword,
  };
  if (data.user_id !== undefined) {
    backendPayload.user_id = data.user_id;
  }
  if (data.gitRepoUrl) {
    backendPayload.gitRepoUrl = data.gitRepoUrl;
    backendPayload.gitBranch = data.gitBranch;
    backendPayload.gitToken = data.gitToken;
  }
  return request<DeployResponse>('/deploy', {
    method: 'POST',
    body: JSON.stringify(backendPayload),
  });
}

// ----- 仓库管理 -----

interface TestRepoPayload {
  platform: string;
  repoUrl: string;
  authMethod: string;
  credential: string;
}

interface TestRepoResponse {
  connected: boolean;
  message?: string;
}

/** 测试仓库连通性 */
export async function testRepoConnection(
  data: TestRepoPayload
): Promise<TestRepoResponse> {
  return request<TestRepoResponse>('/repos/test-connection', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

interface SaveRepoPayload {
  platform: string;
  repoUrl: string;
  authMethod: string;
  credential: string;
  user_id?: number;
  is_verified?: boolean;
}

interface RepoResponse {
  id: string;
  platform: string;
  repoUrl: string;
}

/** 保存仓库配置 */
export async function saveRepoConfig(data: SaveRepoPayload): Promise<RepoResponse> {
  return request<RepoResponse>('/repos', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ----- Git 操作（HTTPS + Token） -----

export interface GitRef {
  hash: string;
  ref: string;
  name: string;
  type: 'branch' | 'tag';
}

interface LsRemoteResponse {
  refs: GitRef[];
  count: number;
  error?: string;
}

/** 通过后端代理执行 git ls-remote，获取远程仓库的分支和标签 */
export async function gitLsRemote(repoUrl: string, accessToken: string): Promise<LsRemoteResponse> {
  return request<LsRemoteResponse>('/git/ls-remote', {
    method: 'POST',
    body: JSON.stringify({ repoUrl, accessToken }),
  });
}

// ----- 用户 CRUD -----

interface UserListItem {
  id: number;
  username: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** 获取所有用户列表 */
export async function getUsers(): Promise<UserListItem[]> {
  return request<UserListItem[]>('/users', { method: 'GET' });
}

/** 更新用户信息 */
export async function updateUser(id: number, data: Partial<{ username: string; password: string; role: string; is_active: number }>): Promise<UserListItem> {
  return request<UserListItem>(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除指定用户，force=true 时强制断开在线用户并删除 */
export async function deleteUser(id: number, force = false): Promise<void> {
  const query = force ? '?force=true' : '';
  return request<void>(`/users/${id}${query}`, { method: 'DELETE' });
}

// ----- 模型 CRUD -----

/** 更新模型配置 */
export async function updateModel(id: number, data: Partial<{ provider: string; model_name: string; api_key: string }>): Promise<ModelResponse> {
  return request<ModelResponse>(`/models/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除指定模型 */
export async function deleteModel(id: number): Promise<void> {
  return request<void>(`/models/${id}`, { method: 'DELETE' });
}

// ----- 团队 CRUD -----

interface TeamListItem {
  id: number;
  config_name: string;
  architect_count: number;
  frontend_count: number;
  backend_count: number;
  reviewer_count: number;
  devops_count: number;
  architect_model_id: number | null;
  frontend_model_id: number | null;
  backend_model_id: number | null;
  reviewer_model_id: number | null;
  devops_model_id: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** 获取团队列表，可按用户 ID 过滤 */
export async function getTeams(userId?: number): Promise<TeamListItem[]> {
  const path = userId ? `/teams?user_id=${userId}` : '/teams';
  return request<TeamListItem[]>(path, { method: 'GET' });
}

/** 创建新团队，指定角色人数和模型绑定 */
export async function createTeam(data: { config_name: string; frontend_count: number; backend_count: number; architect_model_id?: number | null; frontend_model_id?: number | null; backend_model_id?: number | null; reviewer_model_id?: number | null; devops_model_id?: number | null }): Promise<TeamListItem> {
  return request<TeamListItem>('/teams', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 更新团队配置 */
export async function updateTeam(id: number, data: Partial<{ config_name: string; frontend_count: number; backend_count: number; architect_model_id: number | null; frontend_model_id: number | null; backend_model_id: number | null; reviewer_model_id: number | null; devops_model_id: number | null }>): Promise<TeamListItem> {
  return request<TeamListItem>(`/teams/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除指定团队 */
export async function deleteTeam(id: number): Promise<void> {
  return request<void>(`/teams/${id}`, { method: 'DELETE' });
}

// ----- 部署 CRUD -----

interface DeployListItem {
  id: number;
  deploy_type: string;
  cloud_host: string | null;
  cloud_port: number | null;
  cloud_user: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** 获取部署配置列表，可按用户 ID 过滤 */
export async function getDeploys(userId?: number): Promise<DeployListItem[]> {
  const path = userId ? `/deploy?user_id=${userId}` : '/deploy';
  return request<DeployListItem[]>(path, { method: 'GET' });
}

/** 更新部署配置 */
export async function updateDeploy(id: number, data: Partial<{ deployType: string; serverIp: string; port: string; username: string; password: string }>): Promise<DeployListItem> {
  return request<DeployListItem>(`/deploy/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除指定部署配置 */
export async function deleteDeploy(id: number): Promise<void> {
  return request<void>(`/deploy/${id}`, { method: 'DELETE' });
}

// ----- 仓库 CRUD -----

interface RepoListItem {
  id: number;
  platform: string;
  remote_url: string;
  auth_type: string;
  default_branch: string;
  is_verified: number;
  created_at: string;
  updated_at: string;
}

/** 获取仓库列表，可按用户 ID 过滤 */
export async function getRepos(userId?: number): Promise<RepoListItem[]> {
  const path = userId ? `/repos?user_id=${userId}` : '/repos';
  return request<RepoListItem[]>(path, { method: 'GET' });
}

/** 更新仓库配置 */
export async function updateRepo(id: number, data: Partial<{ platform: string; repoUrl: string; authMethod: string; credential: string }>): Promise<RepoListItem> {
  return request<RepoListItem>(`/repos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除指定仓库 */
export async function deleteRepo(id: number): Promise<void> {
  return request<void>(`/repos/${id}`, { method: 'DELETE' });
}

// ----- VS Code Server 管理 -----

interface VscodeStatusResponse {
  installed: boolean;
  serverPath?: string;
  commitId?: string;
  extensions?: string[];
}

/** 获取用户的 VS Code Server 安装状态 */
export async function getVscodeStatus(userId: number): Promise<VscodeStatusResponse> {
  return request<VscodeStatusResponse>(`/users/${userId}/vscode-server/status`, { method: 'GET' });
}

/** 重新安装用户的 VS Code Server */
export async function reinstallVscode(userId: number): Promise<{ message: string }> {
  return request<{ message: string }>(`/users/${userId}/vscode-server/reinstall`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ----- Claude OAuth 认证 -----

interface ClaudeAuthStartResponse {
  sessionId: string;
  oauthUrl: string;
}

/** 启动 Claude OAuth 认证流程，返回 sessionId 和 OAuth URL */
export async function startClaudeAuth(userId: number): Promise<ClaudeAuthStartResponse> {
  const raw = await request<{ session_id: string; oauth_url: string }>(`/users/${userId}/claude-auth/login/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return { sessionId: raw.session_id, oauthUrl: raw.oauth_url };
}

interface ClaudeAuthSubmitResponse {
  success: boolean;
  error?: string;
}

/** 提交 OAuth 授权码完成 Claude 认证 */
export async function submitClaudeCode(userId: number, code: string, sessionId?: string): Promise<ClaudeAuthSubmitResponse> {
  try {
    await request<void>(`/users/${userId}/claude-auth/login/submit-code`, {
      method: 'POST',
      body: JSON.stringify({ code, session_id: sessionId }),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface ClaudeAuthLoginStatus {
  status: 'idle' | 'awaiting_code' | 'exchanging' | 'success' | 'failed' | 'cancelled' | 'timeout';
  error?: string;
}

/** 轮询 Claude 认证登录状态 */
export async function getClaudeAuthLoginStatus(userId: number, sessionId?: string): Promise<ClaudeAuthLoginStatus> {
  const qs = sessionId ? `?session_id=${sessionId}` : '';
  return request<ClaudeAuthLoginStatus>(`/users/${userId}/claude-auth/login/status${qs}`, { method: 'GET' });
}

/** 取消进行中的 Claude 认证会话 */
export async function cancelClaudeAuth(userId: number, sessionId?: string): Promise<void> {
  return request<void>(`/users/${userId}/claude-auth/login/cancel`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  });
}

interface ClaudeAuthCheckResponse {
  authenticated: boolean;
  expiresAt?: string;
  email?: string;
}

/** 检查用户的 Claude 认证状态和过期时间 */
export async function checkClaudeAuth(userId: number): Promise<ClaudeAuthCheckResponse> {
  return request<ClaudeAuthCheckResponse>(`/users/${userId}/claude-auth/status`, { method: 'GET' });
}

/** 退出用户的 Claude 认证 */
export async function logoutClaude(userId: number): Promise<void> {
  return request<void>(`/users/${userId}/claude-auth/logout`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ----- SSH 密钥管理 -----

interface SshKeyItem {
  id: number;
  user_id: number;
  key_type: string;
  public_key: string;
  fingerprint: string;
  comment: string | null;
  created_at: string;
}

/** 获取用户的 SSH 公钥列表 */
export async function getSshKeys(userId: number): Promise<SshKeyItem[]> {
  return request<SshKeyItem[]>(`/users/${userId}/ssh-keys`, { method: 'GET' });
}

/** 为用户添加 SSH 公钥 */
export async function addSshKey(userId: number, publicKey: string): Promise<SshKeyItem> {
  return request<SshKeyItem>(`/users/${userId}/ssh-keys`, {
    method: 'POST',
    body: JSON.stringify({ public_key: publicKey }),
  });
}

/** 删除用户的指定 SSH 公钥 */
export async function deleteSshKey(userId: number, keyId: number): Promise<void> {
  return request<void>(`/users/${userId}/ssh-keys/${keyId}`, { method: 'DELETE' });
}

// ----- Box 桩函数（向后兼容） -----

interface BoxItem {
  id: number;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  ssh_auth_method: 'password' | 'key';
  status: 'connected' | 'disconnected' | 'unknown';
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface BoxDetailItem extends BoxItem {
  admins: { id: number; username: string; role: string; is_active: number; created_at: string }[];
}

/**
 * Stub: getBox is not available in box-system (no boxes table).
 * Returns a rejected promise to prevent runtime errors from cascading.
 */
export async function getBox(_id: number): Promise<BoxDetailItem> {
  throw new Error('getBox is not available in box-system');
}

export type { UserListItem, ModelResponse, TeamListItem, DeployListItem, RepoListItem, BoxItem, BoxDetailItem, LoginResponse, VscodeStatusResponse, ClaudeAuthStartResponse, ClaudeAuthLoginStatus, ClaudeAuthCheckResponse, SshKeyItem };
