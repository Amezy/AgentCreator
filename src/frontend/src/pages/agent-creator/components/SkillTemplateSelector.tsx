import React, { useEffect, useState } from 'react';
import { skillTemplateApi } from '../../../services/agentCreatorApi';

interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  default_tools: string[];
  default_instructions: string;
  sort_order: number;
}

interface SkillTemplateSelectorProps {
  onSelect: (template: SkillTemplate) => void;
  onCancel: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: '通用',
  engineering: '工程',
  consulting: '咨询',
};

const SkillTemplateSelector: React.FC<SkillTemplateSelectorProps> = ({ onSelect, onCancel }) => {
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    skillTemplateApi.list().then((data) => {
      setTemplates(data);
      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : '加载模板失败，请稍后重试');
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">加载模板中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-red-500">{error}</p>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-100"
        >
          返回
        </button>
      </div>
    );
  }

  // Group by category
  const grouped: Record<string, SkillTemplate[]> = {};
  for (const tpl of templates) {
    const cat = tpl.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(tpl);
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">选择技能模板</h2>
          <p className="text-sm text-gray-500 mt-1">选择一个模板作为起点，或从空白技能开始</p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-100"
        >
          返回
        </button>
      </div>

      {/* Template Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {Object.entries(grouped).map(([category, tpls]) => (
          <div key={category} className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              {CATEGORY_LABELS[category] || category}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {tpls.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => onSelect(tpl)}
                  className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left group"
                >
                  <span className="text-2xl flex-shrink-0">{tpl.icon}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 group-hover:text-blue-700">
                      {tpl.name}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                      {tpl.description}
                    </p>
                    {tpl.default_tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tpl.default_tools.map((tool) => (
                          <span
                            key={tool}
                            className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkillTemplateSelector;
