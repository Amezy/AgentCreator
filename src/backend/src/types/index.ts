// ==================== Roles ====================

export type UserRole = 'super_admin' | 'admin' | 'programmer';

// ==================== User ====================

export interface User {
  id: number;
  username: string;
  role: UserRole;
  box_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: number;
  username: string;
  role: UserRole;
  box_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateUserBody {
  username: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserBody {
  username?: string;
  password?: string;
  role?: UserRole;
  is_active?: number;
}

export interface LoginBody {
  username: string;
  password: string;
}

// ==================== JWT ====================

export interface JwtPayload {
  userId: number;
  username: string;
  role: UserRole;
  boxId?: string | null;
}

// ==================== Model Credentials ====================

export interface ModelCredential {
  id: number;
  user_id: number;
  provider: 'anthropic' | 'google' | 'openai';
  model_name: string;
  api_key_enc: string;
  is_verified: number;
  quota_limit: number | null;
  quota_used: number;
  created_at: string;
  updated_at: string;
}

export interface ModelCredentialPublic {
  id: number;
  user_id: number;
  provider: 'anthropic' | 'google' | 'openai';
  model_name: string;
  is_verified: number;
  quota_limit: number | null;
  quota_used: number;
  created_at: string;
  updated_at: string;
}

export interface CreateModelBody {
  provider: 'anthropic' | 'google' | 'openai';
  model_name: string;
  api_key?: string;
  quota_limit?: number | null;
  is_verified?: boolean;
  user_id?: number;
}

export interface UpdateModelBody {
  provider?: 'anthropic' | 'google' | 'openai';
  model_name?: string;
  api_key?: string;
  quota_limit?: number | null;
}

// ==================== Team Config ====================

export interface TeamConfig {
  id: number;
  user_id: number;
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

// ==================== Deployment Config ====================

export interface DeploymentConfig {
  id: number;
  user_id: number;
  deploy_type: 'local' | 'cloud' | 'manual';
  cloud_host: string | null;
  cloud_port: number;
  cloud_user: string | null;
  cloud_pass_enc: string | null;
  ssh_key_enc: string | null;
  docker_registry: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// ==================== Git Repository ====================

export interface GitRepository {
  id: number;
  user_id: number;
  platform: 'github' | 'gitlab' | 'gitee' | 'custom';
  remote_url: string;
  auth_type: 'token' | 'ssh_key';
  auth_cred_enc: string;
  default_branch: string;
  is_verified: number;
  created_at: string;
  updated_at: string;
}

// ==================== Agent Instance ====================

export interface AgentInstance {
  id: number;
  team_config_id: number;
  role: 'architect' | 'frontend' | 'backend' | 'reviewer' | 'devops';
  container_id: string | null;
  status: 'idle' | 'coding' | 'blocked' | 'error' | 'suspended';
  model_name: string;
  cpu_limit: number;
  memory_limit: string;
  pid: number | null;
  last_heartbeat: string | null;
  error_count: number;
  error_log: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== Agent Superpowers ====================

export interface AgentSuperpower {
  id: number;
  agent_instance_id: number;
  prompt_override: string | null;
  rules_json: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== System Events ====================

export type EventType =
  | 'agent_start'
  | 'agent_stop'
  | 'agent_error'
  | 'agent_blocked'
  | 'circuit_break'
  | 'resource_alert'
  | 'network_freeze'
  | 'rate_limit'
  | 'deploy_success'
  | 'deploy_fail'
  | 'user_action'
  | 'vscode_install'
  | 'claude_md_generate'
  | 'deploy_yaml_generate';

export type Severity = 'info' | 'warn' | 'error' | 'critical';

export interface SystemEvent {
  id: number;
  event_type: EventType;
  agent_id: number | null;
  severity: Severity;
  message: string;
  metadata_json: string | null;
  created_at: string;
}

// ==================== Team Config Request Bodies ====================

export interface CreateTeamBody {
  user_id?: number;
  config_name?: string;
  frontend_count?: number;
  backend_count?: number;
  architect_model_id?: number | null;
  frontend_model_id?: number | null;
  backend_model_id?: number | null;
  reviewer_model_id?: number | null;
  devops_model_id?: number | null;
  agents?: { role: string; count: number; superpowersPrompt?: string }[];
}

export interface UpdateTeamBody {
  config_name?: string;
  frontend_count?: number;
  backend_count?: number;
  architect_model_id?: number | null;
  frontend_model_id?: number | null;
  backend_model_id?: number | null;
  reviewer_model_id?: number | null;
  devops_model_id?: number | null;
}

// ==================== Deployment Config Request Bodies ====================

export interface CreateDeployBody {
  deployType: string;
  serverIp?: string;
  port?: string | number;
  username?: string;
  password?: string;
  sshKey?: string;
  user_id?: number;
  /** Git repo URL for deploy.yaml generation */
  gitRepoUrl?: string;
  /** Git branch for deploy.yaml generation */
  gitBranch?: string;
  /** Git access token for deploy.yaml generation */
  gitToken?: string;
}

export interface TestDeployConnectionBody {
  serverIp: string;
  port: string | number;
  username: string;
  password?: string;
  sshKey?: string;
}

export interface DeploymentConfigPublic {
  id: number;
  user_id: number;
  deploy_type: string;
  cloud_host: string | null;
  cloud_port: number;
  cloud_user: string | null;
  docker_registry: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// ==================== Git Repository Request Bodies ====================

export interface CreateRepoBody {
  platform: string;
  repoUrl: string;
  authMethod: string;
  credential: string;
  user_id?: number;
  is_verified?: boolean;
}

export interface TestRepoConnectionBody {
  platform: string;
  repoUrl: string;
  authMethod: string;
  credential: string;
}

export interface GitRepositoryPublic {
  id: number;
  user_id: number;
  platform: string;
  remote_url: string;
  auth_type: string;
  default_branch: string;
  is_verified: number;
  created_at: string;
  updated_at: string;
}

// ==================== API Response ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ==================== SSH Keys ====================

export interface UserSSHKey {
  id: number;
  user_id: number;
  key_type: string;
  public_key: string;
  fingerprint: string;
  comment: string | null;
  created_at: string;
}

export interface AddSSHKeyBody {
  public_key: string;
}

// ==================== Claude Auth ====================

export type ClaudeAuthStatus = 'idle' | 'awaiting_code' | 'exchanging' | 'success' | 'failed' | 'cancelled' | 'timeout';

export interface ClaudeAuthSession {
  sessionId: string;
  userId: number;
  username: string;
  status: ClaudeAuthStatus;
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  oauthUrl: string;
  createdAt: number;
  expiresAt: number;
  error?: string;
}

export interface SubmitCodeBody {
  code: string;
  session_id?: string;
}

// ==================== Daemon API ====================

export interface DaemonCreateUserBody {
  username: string;
  password: string;
  role?: UserRole;
}

export interface DaemonUpdatePasswordBody {
  username: string;
  password: string;
}

export interface DaemonDeleteUserBody {
  username: string;
}

export interface DaemonUserToggleBody {
  username: string;
}

export interface DaemonAuthValidateBody {
  username: string;
  password: string;
}

// ==================== Fastify Extensions ====================

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
    daemonAuth?: boolean;
  }
}
