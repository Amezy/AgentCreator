/**
 * @module types
 * @description 概览页面的类型定义模块。
 * 定义用户配置数据的聚合接口，汇总从多个 API 加载的数据。
 */
import type { ModelResponse, TeamListItem, DeployListItem, RepoListItem, VscodeStatusResponse, ClaudeAuthCheckResponse, SshKeyItem } from '../../services/api';

/** 单个用户的全部配置数据聚合 */
export interface UserConfigData {
  /** 用户关联的模型列表 */
  models: ModelResponse[];
  /** 用户的团队配置列表 */
  teams: TeamListItem[];
  /** 用户的部署配置列表 */
  deploys: DeployListItem[];
  /** 用户的仓库关联列表 */
  repos: RepoListItem[];
  /** VS Code Server 安装状态 */
  vscodeStatus: VscodeStatusResponse | null;
  /** Claude OAuth 认证状态 */
  claudeAuth: ClaudeAuthCheckResponse | null;
  /** SSH 公钥列表 */
  sshKeys: SshKeyItem[];
  /** 数据是否已加载完成 */
  loaded: boolean;
}
