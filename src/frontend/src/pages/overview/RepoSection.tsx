/**
 * @module RepoSection
 * @description Git 仓库子区块组件。
 * 展示用户关联的代码仓库信息，包含平台、地址和验证状态，
 * 支持编辑和删除操作。
 */
import React from 'react';
import { SubSection, StatusBadge, icons } from './shared';
import type { RepoListItem } from '../../services/api';

interface Props {
  repo: RepoListItem | null;
  onEdit: (repo: RepoListItem) => void;
  onDelete: (repoId: number) => void;
  onAdd: () => void;
}

const RepoSection: React.FC<Props> = ({ repo, onEdit, onDelete, onAdd }) => {
  return (
    <SubSection
      icon={icons.repo}
      title="Git 仓库"
      badge={repo ? '已关联' : '未关联'}
    >
      <div className="px-4 py-3">
        {repo ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="label-medium text-on-surface-variant w-20">平台</span>
              <span className="body-medium text-on-surface">{repo.platform}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="label-medium text-on-surface-variant w-20">地址</span>
              <span className="body-medium text-on-surface font-mono text-xs">{repo.remote_url}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="label-medium text-on-surface-variant w-20">状态</span>
              <StatusBadge ok={repo.is_verified === 1} />
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={() => onEdit(repo)} className="label-small text-primary hover:underline">编辑</button>
              <button type="button" onClick={() => onDelete(repo.id)} className="label-small text-error hover:underline">删除</button>
            </div>
          </div>
        ) : (
          <div>
            <p className="body-medium text-on-surface-variant mb-2">暂无仓库关联</p>
            <button type="button" onClick={onAdd} className="label-medium text-primary hover:underline">+ 关联仓库</button>
          </div>
        )}
      </div>
    </SubSection>
  );
};

export default RepoSection;
