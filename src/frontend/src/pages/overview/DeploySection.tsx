/**
 * @module DeploySection
 * @description 部署配置子区块组件。
 * 展示用户的部署配置信息，区分本地部署和云端部署，
 * 云端部署时显示服务器地址和账号，支持编辑和删除操作。
 */
import React from 'react';
import { SubSection, icons } from './shared';
import type { DeployListItem } from '../../services/api';

interface Props {
  deploy: DeployListItem | null;
  onEdit: (deploy: DeployListItem) => void;
  onDelete: (deployId: number) => void;
  onAdd: () => void;
}

const DeploySection: React.FC<Props> = ({ deploy, onEdit, onDelete, onAdd }) => {
  return (
    <SubSection
      icon={icons.deploy}
      title="部署配置"
      badge={deploy ? (deploy.deploy_type === 'local' ? '本地部署' : '云端部署') : '未配置'}
    >
      <div className="px-4 py-3">
        {deploy ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="label-medium text-on-surface-variant w-20">部署方式</span>
              <span className="body-medium text-on-surface">{deploy.deploy_type === 'local' ? '本地部署' : '云端部署'}</span>
            </div>
            {deploy.deploy_type === 'local' ? (
              <div className="px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
                <p className="body-small text-primary">使用本地环境运行，无需额外服务器配置。</p>
              </div>
            ) : (
              <>
                {deploy.cloud_host && (
                  <div className="flex items-center gap-3">
                    <span className="label-medium text-on-surface-variant w-20">服务器</span>
                    <span className="body-medium text-on-surface font-mono">{deploy.cloud_host}:{deploy.cloud_port}</span>
                  </div>
                )}
                {deploy.cloud_user && (
                  <div className="flex items-center gap-3">
                    <span className="label-medium text-on-surface-variant w-20">账号</span>
                    <span className="body-medium text-on-surface">{deploy.cloud_user}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={() => onEdit(deploy)} className="label-small text-primary hover:underline">编辑</button>
              <button type="button" onClick={() => onDelete(deploy.id)} className="label-small text-error hover:underline">删除</button>
            </div>
          </div>
        ) : (
          <div>
            <p className="body-medium text-on-surface-variant mb-2">暂无部署配置</p>
            <button type="button" onClick={onAdd} className="label-medium text-primary hover:underline">+ 配置部署</button>
          </div>
        )}
      </div>
    </SubSection>
  );
};

export default DeploySection;
