/**
 * @module ModelSection
 * @description 模型配置子区块组件。
 * 在用户卡片展开后显示该用户关联的所有 AI 模型，
 * 按提供商分组展示模型名称和验证状态。
 */
import React from 'react';
import { SubSection, StatusBadge, icons, getProviderLabel, getModelLabel } from './shared';
import type { ModelResponse } from '../../services/api';

interface Props {
  models: ModelResponse[];
}

const ModelSection: React.FC<Props> = ({ models }) => {
  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <SubSection
      icon={icons.model}
      title="模型配置"
      badge={`${providers.length} 个提供商`}
      defaultOpen
    >
      <div className="px-4 py-3 space-y-3">
        {models.length === 0 ? (
          <p className="body-medium text-on-surface-variant">暂无模型配置</p>
        ) : (() => {
          const grouped: Record<string, ModelResponse[]> = {};
          models.forEach((m) => {
            if (!grouped[m.provider]) grouped[m.provider] = [];
            grouped[m.provider].push(m);
          });
          return Object.entries(grouped).map(([provider, providerModels]) => {
            const allVerified = providerModels.every((m) => m.is_verified === 1);
            return (
              <div key={provider} className="flex items-center gap-3 py-2 border-b border-outline-variant last:border-b-0">
                <div className="flex-1">
                  <span className="title-small text-on-surface">{getProviderLabel(provider)}</span>
                  <p className="body-small text-on-surface-variant mt-0.5">
                    {providerModels.map((m) => getModelLabel(m.model_name)).join('、')}
                  </p>
                </div>
                <StatusBadge ok={allVerified} />
              </div>
            );
          });
        })()}
      </div>
    </SubSection>
  );
};

export default ModelSection;
