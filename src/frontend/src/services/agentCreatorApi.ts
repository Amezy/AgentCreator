/**
 * @module agentCreatorApi
 * @description AgentCreator 模块的 API 服务层。
 * 封装模型池、技能池和 MCP 连接池的 CRUD 及专用操作接口。
 */

const AGENT_API_BASE = '/api/v1/agent';

/** 后端统一响应信封格式 */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 通用请求封装，自动附加 JWT 认证和 JSON Content-Type
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('jwt_token');
  const resp = await fetch(`${AGENT_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  const text = await resp.text();
  if (!text) return undefined as T;

  const data = JSON.parse(text) as ApiEnvelope<T>;
  if (!data.success) throw new Error(data.error || data.message || '请求失败');
  return data.data as T;
}

// ===== 模型池 API =====

export const modelApi = {
  /** 获取模型列表，支持查询参数过滤 */
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/models${query}`);
  },
  /** 创建模型 */
  create: (data: any) =>
    request<any>('/models', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新模型 */
  update: (id: string, data: any) =>
    request<any>(`/models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除模型 */
  delete: (id: string) =>
    request<void>(`/models/${id}`, { method: 'DELETE' }),
  /** 健康检查 */
  healthCheck: (id: string) =>
    request<any>(`/models/${id}/health-check`, { method: 'POST' }),
  /** 获取配额用量 */
  usage: (id: string) =>
    request<any>(`/models/${id}/usage`),
};

// ===== 技能池 API =====

export const skillApi = {
  /** 获取技能列表，支持查询参数过滤 */
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/skills${query}`);
  },
  /** 获取技能详情 */
  get: (id: string) => request<any>(`/skills/${id}`),
  /** 创建技能 */
  create: (data: any) =>
    request<any>('/skills', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新技能 */
  update: (id: string, data: any) =>
    request<any>(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除技能 */
  delete: (id: string) =>
    request<void>(`/skills/${id}`, { method: 'DELETE' }),
  /** 根据岗位和等级获取推荐技能 */
  forPosition: (posId: string, level: string) =>
    request<any>(`/skills/for-position/${posId}?level=${level}`),
  /** 获取可用的预置工具列表 */
  availableTools: () => request<any[]>('/skills/available-tools'),
  /** 上传并解析 SKILL.md 文件 */
  parseSkillMd: async (file: File) => {
    const token = localStorage.getItem('jwt_token');
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch(`${AGENT_API_BASE}/skills/parse-skillmd`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || data.message || '解析失败');
    return data.data;
  },
  /** 导出技能为 SKILL.md */
  export: async (id: string) => {
    const token = localStorage.getItem('jwt_token');
    const resp = await fetch(`${AGENT_API_BASE}/skills/${id}/export`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error('导出失败');
    return resp.text();
  },
};

// ─── Skill Templates ────────────────────────────────────
export const skillTemplateApi = {
  list: (params?: { category?: string }) => {
    const query = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return request<any[]>(`/skill-templates${query}`);
  },

  get: (id: string) =>
    request<any>(`/skill-templates/${id}`),
};

// ===== MCP 连接池 API =====

export const mcpApi = {
  /** 获取 MCP 连接列表，支持查询参数过滤 */
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/mcp-connections${query}`);
  },
  /** 创建 MCP 连接 */
  create: (data: any) =>
    request<any>('/mcp-connections', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新 MCP 连接 */
  update: (id: string, data: any) =>
    request<any>(`/mcp-connections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除 MCP 连接 */
  delete: (id: string) =>
    request<void>(`/mcp-connections/${id}`, { method: 'DELETE' }),
  /** 测试 MCP 连接 */
  test: (id: string) =>
    request<any>(`/mcp-connections/${id}/test`, { method: 'POST' }),
};

// ===== 市场 API =====

export const marketApi = {
  /** 获取市场连接器列表 */
  list: (params?: { type?: string; q?: string; page?: number; pageSize?: number; sort?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.q) searchParams.set('q', params.q);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.sort) searchParams.set('sort', params.sort);
    const query = searchParams.toString();
    return request<any>(`/market/items${query ? `?${query}` : ''}`);
  },
  /** 获取市场条目详情 */
  detail: (id: string) => request<any>(`/market/items/${id}`),
  /** 记录安装 */
  recordInstall: (id: string) =>
    request<any>(`/market/items/${id}/install`, { method: 'POST' }),
};

// ===== 岗位 API =====

export const positionApi = {
  /** 获取岗位列表，可按分类过滤 */
  list: (category?: string) =>
    request<any[]>(`/positions${category ? `?category=${category}` : ''}`),
  /** 获取单个岗位 */
  get: (id: string) => request<any>(`/positions/${id}`),
  /** 获取岗位引导问题 */
  getGuideQuestions: (positionId: string, level: string) =>
    request<any>(`/positions/${positionId}/guide-questions?level=${level}`),
};

// ===== 人设模板 API =====

export const templateApi = {
  /** 获取模板列表 */
  list: (params?: { position_id?: string; level?: string }) => {
    const query = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<any[]>(`/persona-templates${query ? `?${query}` : ''}`);
  },
  /** 获取自动推荐配置 */
  getAutoConfig: (positionId: string, level: string) =>
    request<any>(`/persona-templates/auto-config?position_id=${positionId}&level=${level}`),
};

// ===== 人设（数字员工）API =====

export const personaApi = {
  /** 获取人设列表 */
  list: (params?: { position_id?: string; level?: string; status?: string }) => {
    const query = params ? new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
    ).toString() : '';
    return request<any[]>(`/personas${query ? `?${query}` : ''}`);
  },
  /** 获取单个人设 */
  get: (id: string) => request<any>(`/personas/${id}`),
  /** 创建人设 */
  create: (data: any) =>
    request<any>('/personas', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新人设 */
  update: (id: string, data: any) =>
    request<any>(`/personas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除人设 */
  delete: (id: string) =>
    request<void>(`/personas/${id}`, { method: 'DELETE' }),
  /** 更新人设状态 */
  updateStatus: (id: string, status: string) =>
    request<any>(`/personas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  /** 生成系统提示词 */
  generatePrompt: (data: any) =>
    request<any>('/personas/generate-prompt', { method: 'POST', body: JSON.stringify(data) }),
  /** 获取人设统计 */
  getStats: () => request<any>('/personas/stats'),
};

// ===== 团队 API =====

export const teamApi = {
  /** 获取团队列表 */
  list: (params?: { is_active?: string }) => {
    const query = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
    ).toString() : '';
    return request<any[]>(`/teams${query}`);
  },
  /** 获取单个团队详情 */
  get: (id: string) => request<any>(`/teams/${id}`),
  /** 创建团队 */
  create: (data: any) =>
    request<any>('/teams', { method: 'POST', body: JSON.stringify(data) }),
  /** 从模板创建团队 */
  createFromTemplate: (data: any) =>
    request<any>('/teams/from-template', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新团队 */
  update: (id: string, data: any) =>
    request<any>(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除团队 */
  delete: (id: string) =>
    request<void>(`/teams/${id}`, { method: 'DELETE' }),
  /** 获取团队统计 */
  getStats: () => request<any>('/teams/stats'),
  /** 获取团队模板列表 */
  getTemplates: () => request<any>('/teams/templates'),
  /** 激活团队 */
  activate: (id: string) =>
    request<any>(`/teams/${id}/activate`, { method: 'PATCH' }),
  /** 停用团队 */
  deactivate: (id: string) =>
    request<any>(`/teams/${id}/deactivate`, { method: 'PATCH' }),
  /** 添加角色 */
  addRole: (teamId: string, data: any) =>
    request<any>(`/teams/${teamId}/roles`, { method: 'POST', body: JSON.stringify(data) }),
  /** 更新角色 */
  updateRole: (roleId: string, data: any) =>
    request<any>(`/teams/roles/${roleId}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除角色 */
  removeRole: (roleId: string) =>
    request<void>(`/teams/roles/${roleId}`, { method: 'DELETE' }),
  /** 分配员工到角色 */
  assignPersona: (roleId: string, personaId: string) =>
    request<any>(`/teams/roles/${roleId}/assign`, { method: 'PATCH', body: JSON.stringify({ persona_id: personaId }) }),
  /** 取消分配员工 */
  unassignPersona: (roleId: string) =>
    request<any>(`/teams/roles/${roleId}/unassign`, { method: 'PATCH' }),
};

// ===== 会话 API =====

export const conversationApi = {
  /** 获取会话列表 */
  list: (params?: { type?: string; is_active?: string }) => {
    const query = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
        ).toString()
      : '';
    return request<any[]>(`/conversations${query}`);
  },
  /** 获取单个会话 */
  get: (id: string) => request<any>(`/conversations/${id}`),
  /** 创建会话 */
  create: (data: { type: string; title?: string; participants: string[]; team_id?: string }) =>
    request<any>('/conversations', { method: 'POST', body: JSON.stringify(data) }),
  /** 关闭会话 */
  close: (id: string) =>
    request<any>(`/conversations/${id}/close`, { method: 'PATCH' }),
  /** 获取会话消息 */
  getMessages: (id: string, params?: { limit?: number; before_id?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.before_id) searchParams.set('before_id', params.before_id);
    const query = searchParams.toString();
    return request<any[]>(`/conversations/${id}/messages${query ? `?${query}` : ''}`);
  },
};

// ===== 工作流 API =====

export const workflowApi = {
  /** 获取工作流列表 */
  list: (params?: { is_active?: string }) => {
    const query = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
        ).toString()
      : '';
    return request<any[]>(`/workflows${query}`);
  },
  /** 获取单个工作流（含节点和边） */
  get: (id: string) => request<any>(`/workflows/${id}`),
  /** 创建工作流 */
  create: (data: any) =>
    request<any>('/workflows', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新工作流元数据 */
  update: (id: string, data: any) =>
    request<any>(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除工作流 */
  delete: (id: string) =>
    request<void>(`/workflows/${id}`, { method: 'DELETE' }),
  /** 添加节点 */
  addNode: (workflowId: string, data: any) =>
    request<any>(`/workflows/${workflowId}/nodes`, { method: 'POST', body: JSON.stringify(data) }),
  /** 更新节点 */
  updateNode: (nodeId: string, data: any) =>
    request<any>(`/workflows/nodes/${nodeId}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除节点 */
  deleteNode: (nodeId: string) =>
    request<void>(`/workflows/nodes/${nodeId}`, { method: 'DELETE' }),
  /** 添加边 */
  addEdge: (workflowId: string, data: any) =>
    request<any>(`/workflows/${workflowId}/edges`, { method: 'POST', body: JSON.stringify(data) }),
  /** 删除边 */
  deleteEdge: (edgeId: string) =>
    request<void>(`/workflows/edges/${edgeId}`, { method: 'DELETE' }),
  /** 验证工作流 */
  validate: (id: string) =>
    request<any>(`/workflows/${id}/validate`, { method: 'POST' }),
  /** 执行工作流 */
  execute: (id: string) =>
    request<any>(`/workflows/${id}/execute`, { method: 'POST' }),
};

// ===== 监控 API =====

export const monitorApi = {
  /** 获取系统资源统计 (CPU, 内存, 磁盘) */
  getSystemStats: () => request<any>('/monitor/system'),
  /** 获取数字员工/团队统计 */
  getAgentStats: () => request<any>('/monitor/agents'),
  /** 获取模型使用统计 */
  getModelUsage: () => request<any>('/monitor/models'),
  /** 获取最近活动 */
  getRecentActivity: (limit?: number) =>
    request<any[]>(`/monitor/activity${limit ? `?limit=${limit}` : ''}`),
  /** 获取系统健康状态 */
  getHealth: () => request<any>('/monitor/health'),
};

// ─── Execution Types ───────────────────────────────
export interface ExecutionInfo {
  id: string;
  workflow_id: string;
  persona_id: string;
  task_title: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  total_steps: number;
  completed_steps: number;
  total_tokens_used: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface StepInfo {
  step_number: number;
  step_label: string;
  status: string;
  tokens_used: number;
  tool_calls_count: number;
  summary_json: {
    key_findings?: string[];
    artifacts?: { type: string; content: string }[];
    context_for_next?: string;
  } | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface StepLogEntry {
  timestamp?: number;
  type?: string;
  [key: string]: unknown;
}

export interface ContextStatus {
  total_capacity: number;
  used_tokens: number;
  usage_percent: number;
  auto_compact_enabled: boolean;
  estimated_compact_at_step: number | null;
  steps_breakdown: {
    step_number: number;
    label: string;
    tokens: number;
    status: string;
  }[];
}

export interface CompactResult {
  pre_tokens: number;
  post_tokens: number;
  freed_tokens: number;
  trigger: string;
}

// ─── Executions ────────────────────────────────────
export const executionApi = {
  create: (data: { workflow_id: string; persona_id: string; task_title: string; input_context?: string }) =>
    request<ExecutionInfo>('/executions', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) =>
    request<ExecutionInfo>(`/executions/${id}`),

  getSteps: (id: string) =>
    request<StepInfo[]>(`/executions/${id}/steps`),

  getStepLog: (id: string, stepNumber: number) =>
    request<StepLogEntry[]>(`/executions/${id}/steps/${stepNumber}/log`),

  compact: (id: string) =>
    request<CompactResult>(`/executions/${id}/compact`, { method: 'POST' }),

  getContextStatus: (id: string) =>
    request<ContextStatus>(`/executions/${id}/context-status`),
};

// ─── SSE Helpers ────────────────────────────────────
export interface SSEEvent {
  type: 'message' | 'form_update' | 'tools_suggest' | 'instructions_update' | 'step_complete' | 'user_choices' | 'error' | 'done';
  content?: string;
  field?: string;
  value?: string;
  tools?: string[];
  labels?: Record<string, string>;
  step?: number;
  next_step?: number;
  message?: string;
  code?: string;
  question?: string;
  choices?: { id: string; label: string }[];
}

export async function fetchSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('jwt_token');
  const resp = await fetch(`${AGENT_API_BASE}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`SSE request failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event: SSEEvent = JSON.parse(line.slice(6));
          onEvent(event);
        } catch {
          // Skip malformed events
        }
      }
    }
  }

  // Flush remaining buffer after stream ends
  if (buffer.startsWith('data: ')) {
    try {
      const event: SSEEvent = JSON.parse(buffer.slice(6));
      onEvent(event);
    } catch {
      // Skip malformed trailing data
    }
  }
}
