/**
 * @module TeamSection
 * @description 团队配置子区块组件。
 * 展示用户的 Agent 团队列表，包含每个团队的角色组成、人数、
 * 绑定模型和激活状态，支持编辑和删除操作。
 */
import React from 'react';
import { SubSection, StatusBadge, icons, getModelLabel } from './shared';
import type { ModelResponse, TeamListItem } from '../../services/api';

interface Props {
  teams: TeamListItem[];
  models: ModelResponse[];
  onEdit: (team: TeamListItem) => void;
  onDelete: (teamId: number) => void;
  onAdd: () => void;
}

const ROLE_MODEL_KEYS = [
  { roleKey: 'architect', modelKey: 'architect_model_id' as const },
  { roleKey: 'frontend', modelKey: 'frontend_model_id' as const },
  { roleKey: 'backend', modelKey: 'backend_model_id' as const },
  { roleKey: 'reviewer', modelKey: 'reviewer_model_id' as const },
  { roleKey: 'devops', modelKey: 'devops_model_id' as const },
];

function getRoles(t: TeamListItem) {
  return [
    { key: 'architect', label: '架构师', count: t.architect_count || 1, fixed: true },
    { key: 'frontend', label: '前端开发', count: t.frontend_count, fixed: false },
    { key: 'backend', label: '后端开发', count: t.backend_count, fixed: false },
    { key: 'reviewer', label: '代码审查', count: t.reviewer_count || 1, fixed: true },
    { key: 'devops', label: 'DevOps', count: t.devops_count || 1, fixed: true },
  ];
}

const TeamSection: React.FC<Props> = ({ teams, models, onEdit, onDelete, onAdd }) => {
  const totalAgents = teams.reduce(
    (s, t) => s + (t.architect_count || 1) + t.frontend_count + t.backend_count + (t.reviewer_count || 1) + (t.devops_count || 1),
    0
  );

  return (
    <SubSection
      icon={icons.team}
      title="团队配置"
      badge={teams.length > 0 ? `${totalAgents} 个 Agent` : '未配置'}
    >
      <div className="px-4 py-3 space-y-3">
        {teams.length === 0 ? (
          <p className="body-medium text-on-surface-variant">暂无团队配置</p>
        ) : teams.map((t) => {
          const roles = getRoles(t);
          const total = roles.reduce((s, r) => s + r.count, 0);
          return (
            <div key={t.id} className="border border-outline-variant/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="title-small text-on-surface flex-1">{t.config_name || '默认团队'}</span>
                <span className="label-small text-on-surface-variant">{total} 个 Agent</span>
                <StatusBadge ok={t.is_active === 1} okText="活跃" noText="待激活" />
                <button type="button" onClick={() => onEdit(t)} className="label-small text-primary hover:underline">编辑</button>
                <button type="button" onClick={() => onDelete(t.id)} className="label-small text-error hover:underline">删除</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const rm = ROLE_MODEL_KEYS.find((x) => x.roleKey === r.key);
                  const mid = rm ? t[rm.modelKey] : null;
                  const mdl = mid ? models.find((m) => m.id === mid) : null;
                  return (
                    <span key={r.key} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg label-small ${r.fixed ? 'bg-surface-container text-on-surface-variant' : 'bg-primary/10 text-primary'}`}>
                      {r.label}
                      <span className="font-medium">&times;{r.count}</span>
                      {mdl && <span className="text-[10px] opacity-70">&middot; {getModelLabel(mdl.model_name)}</span>}
                    </span>
                  );
                })}
              </div>

            </div>
          );
        })}
        {teams.length === 0 && (
          <button type="button" onClick={onAdd} className="label-medium text-primary hover:underline mt-2">
            + 新建团队
          </button>
        )}
      </div>
    </SubSection>
  );
};

export default TeamSection;
