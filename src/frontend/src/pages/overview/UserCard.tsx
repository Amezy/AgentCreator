/**
 * @module UserCard
 * @description 用户卡片组件 - 概览页面的核心展示单元。
 * 以可折叠卡片的形式展示单个用户的所有配置信息，
 * 展开后包含模型、团队、部署、仓库、VS Code、Claude 认证和 SSH 密钥子区块。
 * 管理员用户显示为只读状态，开发者用户支持编辑和删除操作。
 */
import React, { useState } from 'react';
import Card from '../../components/m3/Card';
import { ChevronIcon, RoleBadge, StatusBadge, getModelLabel } from './shared';
import type { UserListItem } from '../../services/api';
import type { UserConfigData } from './types';
import ModelSection from './ModelSection';
import TeamSection from './TeamSection';
import DeploySection from './DeploySection';
import RepoSection from './RepoSection';
import VscodeSection from './VscodeSection';
import ClaudeAuthSection from './ClaudeAuthSection';
import ClaudeAuthDialog from './ClaudeAuthDialog';
import SshKeySection from './SshKeySection';
import SshKeyDialog from './SshKeyDialog';

interface Props {
  user: UserListItem;
  isExpanded: boolean;
  onToggle: () => void;
  userData: UserConfigData | undefined;
  onEditUser: () => void;
  onDeleteUser: () => void;
  onEditTeam: (team: import('../../services/api').TeamListItem) => void;
  onDeleteTeam: (teamId: number) => void;
  onAddTeam: () => void;
  onEditDeploy: (deploy: import('../../services/api').DeployListItem) => void;
  onDeleteDeploy: (deployId: number) => void;
  onAddDeploy: () => void;
  onEditRepo: (repo: import('../../services/api').RepoListItem) => void;
  onDeleteRepo: (repoId: number) => void;
  onAddRepo: () => void;
  onReload: () => void;
  toast: (msg: string) => void;
}

const UserCard: React.FC<Props> = ({
  user, isExpanded, onToggle, userData,
  onEditUser, onDeleteUser,
  onEditTeam, onDeleteTeam, onAddTeam,
  onEditDeploy, onDeleteDeploy, onAddDeploy,
  onEditRepo, onDeleteRepo, onAddRepo,
  onReload, toast,
}) => {
  const isAdmin = user.role === 'admin';
  const models = userData?.models || [];
  const teams = userData?.teams || [];
  const deploys = userData?.deploys || [];
  const repos = userData?.repos || [];
  const userDeploy = deploys.length > 0 ? deploys[0] : null;
  const userRepo = repos.length > 0 ? repos[0] : null;

  const [claudeDialogOpen, setClaudeDialogOpen] = useState(false);
  const [sshKeyDialogOpen, setSshKeyDialogOpen] = useState(false);

  return (
    <Card variant="elevated" className="!p-0 overflow-hidden">
      {/* User Header */}
      <button
        type="button"
        onClick={() => !isAdmin && onToggle()}
        className={`w-full flex items-center gap-4 px-6 py-4 transition-colors text-left ${isAdmin ? 'cursor-default' : 'hover:bg-surface-container/30'}`}
      >
        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="title-medium text-primary">{user.username[0]?.toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="title-medium text-on-surface">{user.username}</span>
            <RoleBadge role={user.role} />
            <StatusBadge ok={user.is_active === 1} okText="活跃" noText="停用" />
          </div>
          {isAdmin ? (
            <p className="body-small text-on-surface-variant mt-0.5">盒子管理员 &middot; 仅超级管理员可修改</p>
          ) : userData?.loaded ? (
            <p className="body-small text-on-surface-variant mt-0.5">
              {(() => { const p = [...new Set(models.map((m) => m.provider))]; return `提供商 ${p.length} 家`; })()}
              {' \u00B7 '}团队 {teams.length > 0 ? `${teams.reduce((s, t) => s + (t.architect_count || 1) + t.frontend_count + t.backend_count + (t.reviewer_count || 1) + (t.devops_count || 1), 0)} Agent` : '未配置'}
              {' \u00B7 '}部署 {userDeploy ? (userDeploy.deploy_type === 'local' ? '本地' : '云端') : '未配置'}
              {' \u00B7 '}仓库 {userRepo ? '已关联' : '未关联'}
            </p>
          ) : (
            <p className="body-small text-on-surface-variant mt-0.5">点击展开查看配置</p>
          )}
        </div>
        {!isAdmin && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span
              className="label-medium text-primary hover:underline"
              onClick={(e) => { e.stopPropagation(); onEditUser(); }}
            >编辑</span>
            <span
              className="label-medium text-error hover:underline"
              onClick={(e) => { e.stopPropagation(); onDeleteUser(); }}
            >删除</span>
            <ChevronIcon open={isExpanded} />
          </div>
        )}
      </button>

      {/* Expanded sections */}
      {isExpanded && !isAdmin && (
        <div className="px-4 pb-4 space-y-2 border-t border-outline-variant pt-3">
          {!userData?.loaded ? (
            <p className="body-medium text-on-surface-variant text-center py-4">加载中...</p>
          ) : (
            <>
              <ModelSection models={models} />
              <TeamSection teams={teams} models={models} onEdit={onEditTeam} onDelete={onDeleteTeam} onAdd={onAddTeam} />
              <DeploySection deploy={userDeploy} onEdit={onEditDeploy} onDelete={onDeleteDeploy} onAdd={onAddDeploy} />
              <RepoSection repo={userRepo} onEdit={onEditRepo} onDelete={onDeleteRepo} onAdd={onAddRepo} />
              <VscodeSection userId={user.id} status={userData.vscodeStatus} onReload={onReload} toast={toast} />
              <ClaudeAuthSection userId={user.id} auth={userData.claudeAuth} onStartAuth={() => setClaudeDialogOpen(true)} onReload={onReload} toast={toast} />
              <SshKeySection userId={user.id} sshKeys={userData.sshKeys} onAdd={() => setSshKeyDialogOpen(true)} onReload={onReload} toast={toast} />
            </>
          )}
        </div>
      )}

      {/* Dialogs */}
      <ClaudeAuthDialog
        open={claudeDialogOpen}
        userId={user.id}
        onClose={() => setClaudeDialogOpen(false)}
        onSuccess={() => { setClaudeDialogOpen(false); onReload(); }}
        toast={toast}
      />
      <SshKeyDialog
        open={sshKeyDialogOpen}
        userId={user.id}
        onClose={() => setSshKeyDialogOpen(false)}
        onSuccess={() => { setSshKeyDialogOpen(false); onReload(); }}
        toast={toast}
      />
    </Card>
  );
};

export default UserCard;
