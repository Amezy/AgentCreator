/**
 * @module wizardStore
 * @description 配置向导全局状态管理 Store（Zustand）。
 * 管理五步配置向导的所有表单数据（用户、模型、团队、部署、仓库），
 * 以及认证状态、步骤导航、表单校验和全局通知等。
 * 认证信息会持久化到 localStorage 以支持页面刷新后保持登录。
 */
import { create } from 'zustand';

// ----- Type Definitions -----

/** 用户配置表单数据 */
interface UserSetupData {
  username: string;
  password: string;
  role: 'super_admin' | 'admin' | 'programmer';
}

/** 单个模型条目，跟踪自身的验证状态 */
interface ModelEntry {
  /** 模型标识符，如 'opus4.6'、'sonnet4.6' */
  modelId: string;
  /** 模型显示名称 */
  label: string;
  /** OAuth 认证串或 API Key */
  authString: string;
  /** 用户输入的激活令牌/授权码 */
  activationToken: string;
  /** 是否已通过验证 */
  verified: boolean;
}

/** 模型配置数据，支持多模型 */
interface ModelConfigData {
  /** 已选择的模型列表，每个模型独立验证 */
  models: ModelEntry[];
}

/** 单个 Agent 角色的配置 */
interface AgentConfig {
  /** 角色标识，如 'architect'、'frontend' */
  role: string;
  /** 角色中文名称 */
  label: string;
  /** 该角色的 Agent 数量 */
  count: number;
  /** 最小数量 */
  min: number;
  /** 最大数量 */
  max: number;
  /** 是否固定数量（不可调整） */
  fixed: boolean;
  /** Superpowers 技能提示词 */
  superpowersPrompt: string;
  /** 分配的已验证模型 ID */
  assignedModel: string;
}

/** 团队配置数据 */
interface TeamConfigData {
  /** 团队配置名称 */
  configName: string;
  /** Agent 角色列表 */
  agents: AgentConfig[];
}

/** 部署配置数据 */
interface DeployConfigData {
  /** 部署类型：本地或云端 */
  deployType: 'local' | 'cloud';
  /** 云端服务器 IP */
  serverIp: string;
  /** 云端服务器端口 */
  port: string;
  /** 服务器账号 */
  aliAccount: string;
  /** 服务器密码 */
  aliPassword: string;
}

/** Git 仓库配置数据 */
interface RepoConfigData {
  /** 代码平台类型 */
  platform: 'github' | 'gitlab' | 'gitee' | 'custom';
  /** 仓库 HTTPS 地址 */
  repoUrl: string;
  /** 私人访问令牌 */
  accessToken: string;
  /** 连接是否已测试通过 */
  connectionTested: boolean;
  /** 用户选中的分支名称 */
  selectedBranch: string;
}

/** 用户认证状态，持久化到 localStorage */
interface AuthState {
  /** JWT 令牌 */
  token: string | null;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 当前登录用户 ID */
  userId: number | null;
  /** 当前登录用户名 */
  username: string | null;
  /** 用户角色 */
  role: string | null;
  /** 关联的 Box ID */
  boxId: number | null;
}

// ----- Store Interface -----

interface WizardStore {
  // Current wizard step (0-indexed)
  currentStep: number;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;

  // Form data per page
  userSetup: UserSetupData;
  setUserSetup: (data: Partial<UserSetupData>) => void;

  modelConfig: ModelConfigData;
  setModelConfig: (data: Partial<ModelConfigData>) => void;
  toggleModel: (modelId: string, label: string) => void;
  updateModelEntry: (modelId: string, data: Partial<ModelEntry>) => void;

  teamConfig: TeamConfigData;
  setTeamConfig: (data: Partial<TeamConfigData>) => void;
  updateAgent: (index: number, data: Partial<AgentConfig>) => void;

  deployConfig: DeployConfigData;
  setDeployConfig: (data: Partial<DeployConfigData>) => void;

  repoConfig: RepoConfigData;
  setRepoConfig: (data: Partial<RepoConfigData>) => void;

  // Auth state
  auth: AuthState;
  setAuth: (auth: Partial<AuthState>) => void;
  logout: () => void;

  // Step validity (set by each page to enable/disable navigation)
  stepValid: boolean;
  setStepValid: (valid: boolean) => void;

  // Validation errors display (triggered by clicking disabled next button)
  showValidationErrors: boolean;
  setShowValidationErrors: (show: boolean) => void;

  // Snackbar
  snackbar: { open: boolean; message: string };
  showSnackbar: (message: string) => void;
  hideSnackbar: () => void;

  // Wizard-created user ID (the programmer being configured)
  wizardUserId: number | null;
  setWizardUserId: (id: number | null) => void;

  // Reset wizard form data (keeps auth)
  resetWizard: () => void;
}

// ----- Default Values -----

const defaultAgents: AgentConfig[] = [
  { role: 'architect', label: '架构师', count: 1, min: 1, max: 1, fixed: true, superpowersPrompt: 'brainstorming, writing-plans, executing-plans', assignedModel: '' },
  { role: 'frontend', label: '前端开发', count: 1, min: 1, max: 1, fixed: true, superpowersPrompt: 'test-driven-development, subagent-driven-development', assignedModel: '' },
  { role: 'backend', label: '后端开发', count: 1, min: 1, max: 1, fixed: true, superpowersPrompt: 'test-driven-development, subagent-driven-development', assignedModel: '' },
  { role: 'reviewer', label: '代码审查', count: 1, min: 1, max: 1, fixed: true, superpowersPrompt: 'requesting-code-review, receiving-code-review, verification-before-completion', assignedModel: '' },
  { role: 'devops', label: 'DevOps', count: 1, min: 1, max: 1, fixed: true, superpowersPrompt: 'using-git-worktrees, finishing-a-development-branch, dispatching-parallel-agents', assignedModel: '' },
];

// ----- Store -----

const useWizardStore = create<WizardStore>((set) => ({
  // Step
  currentStep: 0,
  setCurrentStep: (step) => set({ currentStep: step }),
  nextStep: () =>
    set((state) => ({
      currentStep: Math.min(state.currentStep + 1, 4),
    })),
  prevStep: () =>
    set((state) => ({
      currentStep: Math.max(state.currentStep - 1, 0),
    })),

  // User Setup
  userSetup: {
    username: '',
    password: '',
    role: 'programmer',
  },
  setUserSetup: (data) =>
    set((state) => ({
      userSetup: { ...state.userSetup, ...data },
    })),

  // Model Config (multi-model)
  modelConfig: {
    models: [],
  },
  setModelConfig: (data) =>
    set((state) => ({
      modelConfig: { ...state.modelConfig, ...data },
    })),
  toggleModel: (modelId, label) =>
    set((state) => {
      const existing = state.modelConfig.models.find((m) => m.modelId === modelId);
      if (existing) {
        // Remove model
        return {
          modelConfig: {
            ...state.modelConfig,
            models: state.modelConfig.models.filter((m) => m.modelId !== modelId),
          },
        };
      }
      // Add model
      return {
        modelConfig: {
          ...state.modelConfig,
          models: [
            ...state.modelConfig.models,
            { modelId, label, authString: '', activationToken: '', verified: false },
          ],
        },
      };
    }),
  updateModelEntry: (modelId, data) =>
    set((state) => ({
      modelConfig: {
        ...state.modelConfig,
        models: state.modelConfig.models.map((m) =>
          m.modelId === modelId ? { ...m, ...data } : m
        ),
      },
    })),

  // Team Config
  teamConfig: {
    configName: '',
    agents: [...defaultAgents],
  },
  setTeamConfig: (data) =>
    set((state) => ({
      teamConfig: { ...state.teamConfig, ...data },
    })),
  updateAgent: (index, data) =>
    set((state) => {
      const agents = [...state.teamConfig.agents];
      agents[index] = { ...agents[index], ...data };
      return { teamConfig: { ...state.teamConfig, agents } };
    }),

  // Deploy Config
  deployConfig: {
    deployType: 'local',
    serverIp: '',
    port: '80',
    aliAccount: '',
    aliPassword: '',
  },
  setDeployConfig: (data) =>
    set((state) => ({
      deployConfig: { ...state.deployConfig, ...data },
    })),

  // Repo Config
  repoConfig: {
    platform: 'gitlab',
    repoUrl: '',
    accessToken: '',
    connectionTested: false,
    selectedBranch: '',
  },
  setRepoConfig: (data) =>
    set((state) => ({
      repoConfig: { ...state.repoConfig, ...data },
    })),

  // Auth
  auth: {
    token: localStorage.getItem('jwt_token'),
    isAuthenticated: !!localStorage.getItem('jwt_token'),
    userId: localStorage.getItem('user_id') ? Number(localStorage.getItem('user_id')) : null,
    username: localStorage.getItem('user_name'),
    role: localStorage.getItem('user_role'),
    boxId: localStorage.getItem('user_box_id') ? Number(localStorage.getItem('user_box_id')) : null,
  },
  setAuth: (auth) =>
    set((state) => {
      const newAuth = { ...state.auth, ...auth };
      if (newAuth.token) {
        localStorage.setItem('jwt_token', newAuth.token);
      }
      if (newAuth.userId !== undefined) {
        if (newAuth.userId !== null) {
          localStorage.setItem('user_id', String(newAuth.userId));
        } else {
          localStorage.removeItem('user_id');
        }
      }
      if (newAuth.username !== undefined) {
        if (newAuth.username !== null) {
          localStorage.setItem('user_name', newAuth.username);
        } else {
          localStorage.removeItem('user_name');
        }
      }
      if (newAuth.role) {
        localStorage.setItem('user_role', newAuth.role);
      }
      if (newAuth.boxId !== undefined) {
        if (newAuth.boxId !== null) {
          localStorage.setItem('user_box_id', String(newAuth.boxId));
        } else {
          localStorage.removeItem('user_box_id');
        }
      }
      return { auth: newAuth };
    }),
  logout: () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('user_name');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_box_id');
    set({ auth: { token: null, isAuthenticated: false, userId: null, username: null, role: null, boxId: null } });
  },

  // Wizard-created user ID
  wizardUserId: null,
  setWizardUserId: (id) => set({ wizardUserId: id }),

  // Step validity
  stepValid: false,
  setStepValid: (valid) => set({ stepValid: valid }),

  // Validation errors
  showValidationErrors: false,
  setShowValidationErrors: (show) => set({ showValidationErrors: show }),

  // Snackbar
  snackbar: { open: false, message: '' },
  showSnackbar: (message) => set({ snackbar: { open: true, message } }),
  hideSnackbar: () => set({ snackbar: { open: false, message: '' } }),

  // Reset wizard form data (keeps auth)
  resetWizard: () =>
    set({
      currentStep: 0,
      stepValid: false,
      showValidationErrors: false,
      wizardUserId: null,
      userSetup: { username: '', password: '', role: 'programmer' },
      modelConfig: { models: [] },
      teamConfig: { configName: '', agents: [...defaultAgents] },
      deployConfig: { deployType: 'local', serverIp: '', port: '80', aliAccount: '', aliPassword: '' },
      repoConfig: { platform: 'gitlab', repoUrl: '', accessToken: '', connectionTested: false, selectedBranch: '' },
    }),
}));

export default useWizardStore;
export type { UserSetupData, ModelEntry, ModelConfigData, AgentConfig, TeamConfigData, DeployConfigData, RepoConfigData };
