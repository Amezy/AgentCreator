/**
 * @module PersonaWizard
 * @description 创建数字员工的 6 步引导向导组件。
 * 步骤：选择岗位 -> 选择等级 -> 引导问题 -> 人设微调 -> 资源分配 -> 确认创建。
 */
import React, { useState, useEffect, useCallback } from 'react';
import Button from '../../../components/m3/Button';
import TextField from '../../../components/m3/TextField';
import TextArea from '../../../components/m3/TextArea';
import Snackbar from '../../../components/m3/Snackbar';
import { positionApi, templateApi, personaApi, modelApi, skillApi, mcpApi } from '../../../services/agentCreatorApi';

// ===== 类型 =====

interface WizardState {
  step: number;
  positionId: string;
  positionName: string;
  positionCategory: string;
  positionMinLevel: string;
  positionDefaultLevel: string;
  level: string;
  guideAnswers: Record<string, string>;
  name: string;
  avatar: string;
  systemPrompt: string;
  resourceMode: 'auto' | 'template';
  modelId: string;
  skillIds: string[];
  mcpIds: string[];
  templateId: string | null;
}

interface PersonaWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

// ===== 常量 =====

const STEPS = [
  { num: 1, title: '选择岗位' },
  { num: 2, title: '选择等级' },
  { num: 3, title: '引导问题' },
  { num: 4, title: '人设微调' },
  { num: 5, title: '资源分配' },
  { num: 6, title: '确认创建' },
];

const LEVELS = [
  { value: 'junior', label: '初级', desc: '基础任务执行，需要明确指令', color: 'bg-primary-container text-on-primary-container' },
  { value: 'mid', label: '中级', desc: '独立完成常规任务，有一定自主判断能力', color: 'bg-secondary-container text-on-secondary-container' },
  { value: 'senior', label: '高级', desc: '处理复杂任务，具备深度专业能力', color: 'bg-tertiary-container text-on-tertiary-container' },
  { value: 'expert', label: '专家', desc: '顶级专业水平，可进行架构级决策', color: 'bg-error-container text-on-error-container' },
];

const LEVEL_ORDER = ['junior', 'mid', 'senior', 'expert'];

const CATEGORY_LABEL: Record<string, string> = { engineering: '工程', consulting: '咨询', general: '通用' };

const initialState: WizardState = {
  step: 1,
  positionId: '',
  positionName: '',
  positionCategory: '',
  positionMinLevel: 'junior',
  positionDefaultLevel: 'mid',
  level: '',
  guideAnswers: {},
  name: '',
  avatar: '',
  systemPrompt: '',
  resourceMode: 'auto',
  modelId: '',
  skillIds: [],
  mcpIds: [],
  templateId: null,
};

// ===== 通用 Select =====

const Select: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  options: { label: string; value: string }[]; className?: string;
}> = ({ label, value, onChange, options, className = '' }) => (
  <div className={`w-full font-roboto ${className}`}>
    <label className="block body-small text-on-surface-variant mb-1 ml-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-transparent border border-outline rounded-xs text-on-surface body-large outline-none focus:border-primary focus:border-2 transition-colors"
    >
      <option value="">全部</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ===== 主组件 =====

const PersonaWizard: React.FC<PersonaWizardProps> = ({ open, onClose, onCreated }) => {
  const [state, setState] = useState<WizardState>({ ...initialState });
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [loading, setLoading] = useState(false);

  // 数据源
  const [positions, setPositions] = useState<any[]>([]);
  const [guideQuestions, setGuideQuestions] = useState<any[]>([]);
  const [autoConfig, setAutoConfig] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [allModels, setAllModels] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allMcps, setAllMcps] = useState<any[]>([]);
  const [promptPreview, setPromptPreview] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // 重置状态
  useEffect(() => {
    if (open) {
      setState({ ...initialState });
      setPromptPreview('');
      setAutoConfig(null);
      setTemplates([]);
    }
  }, [open]);

  // Step 1: 加载岗位列表
  useEffect(() => {
    if (open && state.step === 1 && positions.length === 0) {
      positionApi.list().then((data) => setPositions(data || [])).catch(() => setPositions([]));
    }
  }, [open, state.step, positions.length]);

  // Step 3: 加载引导问题
  useEffect(() => {
    if (state.step === 3 && state.positionId && state.level) {
      setLoading(true);
      positionApi.getGuideQuestions(state.positionId, state.level)
        .then((data) => {
          const qs = Array.isArray(data) ? data : (data?.questions || []);
          setGuideQuestions(qs);
        })
        .catch(() => setGuideQuestions([]))
        .finally(() => setLoading(false));
    }
  }, [state.step, state.positionId, state.level]);

  // Step 5: 加载资源数据
  useEffect(() => {
    if (state.step === 5) {
      setLoading(true);
      Promise.all([
        modelApi.list().catch(() => []),
        skillApi.list().catch(() => []),
        mcpApi.list().catch(() => []),
      ]).then(([models, skills, mcps]) => {
        setAllModels(models || []);
        setAllSkills(skills || []);
        setAllMcps(mcps || []);
      }).finally(() => setLoading(false));

      if (state.resourceMode === 'auto' && state.positionId && state.level) {
        templateApi.getAutoConfig(state.positionId, state.level)
          .then((cfg) => {
            setAutoConfig(cfg);
            if (cfg) {
              update({
                modelId: cfg.recommended_model_id || cfg.modelId || '',
                skillIds: cfg.recommended_skill_ids || cfg.skillIds || [],
                mcpIds: cfg.recommended_mcp_ids || cfg.mcpIds || [],
              });
            }
          })
          .catch(() => setAutoConfig(null));
      }
    }
  }, [state.step, state.resourceMode, state.positionId, state.level, update]);

  // Step 5: 加载模板列表
  useEffect(() => {
    if (state.step === 5 && state.resourceMode === 'template' && state.positionId) {
      templateApi.list({ position_id: state.positionId, level: state.level })
        .then((data) => setTemplates(data || []))
        .catch(() => setTemplates([]));
    }
  }, [state.step, state.resourceMode, state.positionId, state.level]);

  if (!open) return null;

  const canNext = (): boolean => {
    switch (state.step) {
      case 1: return !!state.positionId;
      case 2: return !!state.level;
      case 3: return true; // 引导问题可选
      case 4: return !!state.name.trim();
      case 5: return true;
      case 6: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (state.step < 6) update({ step: state.step + 1 });
  };

  const handlePrev = () => {
    if (state.step > 1) update({ step: state.step - 1 });
  };

  const handleGeneratePrompt = async () => {
    setPromptLoading(true);
    try {
      const result = await personaApi.generatePrompt({
        position_id: state.positionId,
        level: state.level,
        name: state.name,
        guide_answers: state.guideAnswers,
      });
      const prompt = result?.system_prompt || result?.prompt || '';
      setPromptPreview(prompt);
      update({ systemPrompt: prompt });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '生成失败' });
    } finally {
      setPromptLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      await personaApi.create({
        position_id: state.positionId,
        level: state.level,
        name: state.name,
        avatar: state.avatar || undefined,
        system_prompt: state.systemPrompt || promptPreview,
        guide_answers: state.guideAnswers,
        model_id: state.modelId || undefined,
        skill_ids: state.skillIds,
        mcp_ids: state.mcpIds,
        template_id: state.templateId || undefined,
      });
      setSnackbar({ open: true, message: '数字员工创建成功' });
      onCreated?.();
      setTimeout(() => onClose(), 600);
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '创建失败' });
    } finally {
      setCreating(false);
    }
  };

  const selectPosition = (pos: any) => {
    update({
      positionId: pos.id,
      positionName: pos.name,
      positionCategory: pos.category || '',
      positionMinLevel: pos.min_level || pos.minLevel || 'junior',
      positionDefaultLevel: pos.default_level || pos.defaultLevel || 'mid',
      level: pos.default_level || pos.defaultLevel || 'mid',
    });
  };

  const selectTemplate = (tpl: any) => {
    update({
      templateId: tpl.id,
      modelId: tpl.model_id || tpl.modelId || '',
      skillIds: tpl.skill_ids || tpl.skillIds || [],
      mcpIds: tpl.mcp_ids || tpl.mcpIds || [],
    });
  };

  const toggleSkill = (id: string) => {
    update({
      skillIds: state.skillIds.includes(id)
        ? state.skillIds.filter((s) => s !== id)
        : [...state.skillIds, id],
    });
  };

  const toggleMcp = (id: string) => {
    update({
      mcpIds: state.mcpIds.includes(id)
        ? state.mcpIds.filter((m) => m !== id)
        : [...state.mcpIds, id],
    });
  };

  // 按类别分组岗位
  const groupedPositions = positions.reduce<Record<string, any[]>>((acc, pos) => {
    const cat = pos.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pos);
    return acc;
  }, {});

  const levelDisabled = (lv: string) => {
    const minIdx = LEVEL_ORDER.indexOf(state.positionMinLevel);
    const lvIdx = LEVEL_ORDER.indexOf(lv);
    return lvIdx < minIdx;
  };

  // ===== 渲染各步骤 =====

  const renderStep1 = () => (
    <div className="space-y-4">
      <p className="body-medium text-on-surface-variant">选择一个岗位作为数字员工的角色定位</p>
      {Object.keys(groupedPositions).length === 0 ? (
        <div className="bg-surface-container rounded-lg p-8 text-center">
          <p className="body-medium text-on-surface-variant">暂无可用岗位</p>
        </div>
      ) : (
        Object.entries(groupedPositions).map(([cat, items]) => (
          <div key={cat}>
            <h4 className="label-large text-on-surface-variant mb-2">{CATEGORY_LABEL[cat] || cat}</h4>
            <div className="grid grid-cols-2 gap-3">
              {items.map((pos: any) => (
                <button
                  key={pos.id}
                  type="button"
                  onClick={() => selectPosition(pos)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    state.positionId === pos.id
                      ? 'border-primary bg-primary-container/30 shadow-elevation-1'
                      : 'border-outline-variant bg-surface-container hover:bg-on-surface/[0.04]'
                  }`}
                >
                  <p className="title-small text-on-surface">{pos.name}</p>
                  <p className="body-small text-on-surface-variant mt-1 line-clamp-2">{pos.description || ''}</p>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      <p className="body-medium text-on-surface-variant">
        为「{state.positionName}」选择能力等级
      </p>
      <div className="grid grid-cols-2 gap-3">
        {LEVELS.map((lv) => {
          const disabled = levelDisabled(lv.value);
          const selected = state.level === lv.value;
          return (
            <button
              key={lv.value}
              type="button"
              disabled={disabled}
              onClick={() => update({ level: lv.value })}
              className={`text-left p-4 rounded-lg border transition-all ${
                disabled
                  ? 'opacity-40 cursor-not-allowed border-outline-variant bg-surface-container'
                  : selected
                  ? 'border-primary bg-primary-container/30 shadow-elevation-1'
                  : 'border-outline-variant bg-surface-container hover:bg-on-surface/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-block px-2 py-0.5 rounded-full label-small ${lv.color}`}>
                  {lv.label}
                </span>
              </div>
              <p className="body-small text-on-surface-variant mt-1">{lv.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <p className="body-medium text-on-surface-variant">
        回答以下问题帮助我们更好地定制数字员工（可选）
      </p>
      {loading ? (
        <div className="bg-surface-container rounded-lg p-8 text-center">
          <p className="body-medium text-on-surface-variant">加载问题中...</p>
        </div>
      ) : guideQuestions.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-8 text-center">
          <p className="body-medium text-on-surface-variant">暂无引导问题，可直接进入下一步</p>
        </div>
      ) : (
        guideQuestions.map((q: any, idx: number) => {
          const qId = q.id || `q_${idx}`;
          const qText = q.question || q.text || q;
          return (
            <div key={qId}>
              <p className="body-medium text-on-surface mb-2">
                {idx + 1}. {typeof qText === 'string' ? qText : JSON.stringify(qText)}
              </p>
              <TextArea
                label="你的回答"
                value={state.guideAnswers[qId] || ''}
                onChange={(v) => update({ guideAnswers: { ...state.guideAnswers, [qId]: v } })}
                rows={2}
              />
            </div>
          );
        })
      )}
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4">
      <p className="body-medium text-on-surface-variant">设定数字员工的名称和形象</p>
      <TextField
        label="员工名称 *"
        value={state.name}
        onChange={(v) => update({ name: v })}
      />
      <TextField
        label="头像 URL（可选）"
        value={state.avatar}
        onChange={(v) => update({ avatar: v })}
        helperText="留空使用默认头像"
      />
      <div className="flex items-center gap-3">
        <Button
          variant="tonal"
          onClick={handleGeneratePrompt}
          disabled={promptLoading || !state.name.trim()}
        >
          {promptLoading ? '生成中...' : '预览系统提示词'}
        </Button>
      </div>
      {promptPreview && (
        <div className="bg-surface-container rounded-lg p-4 max-h-48 overflow-y-auto">
          <p className="label-small text-on-surface-variant mb-1">系统提示词预览</p>
          <pre className="body-small text-on-surface whitespace-pre-wrap">{promptPreview}</pre>
        </div>
      )}
    </div>
  );

  const renderStep5 = () => (
    <div className="space-y-4">
      <p className="body-medium text-on-surface-variant">为数字员工分配模型、技能和 MCP 连接</p>

      {/* 模式切换 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => update({ resourceMode: 'auto' })}
          className={`px-4 py-2 rounded-full label-large transition-colors ${
            state.resourceMode === 'auto'
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
          }`}
        >
          自动推荐
        </button>
        <button
          type="button"
          onClick={() => update({ resourceMode: 'template' })}
          className={`px-4 py-2 rounded-full label-large transition-colors ${
            state.resourceMode === 'template'
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
          }`}
        >
          从模板选择
        </button>
      </div>

      {loading ? (
        <div className="bg-surface-container rounded-lg p-8 text-center">
          <p className="body-medium text-on-surface-variant">加载资源中...</p>
        </div>
      ) : state.resourceMode === 'auto' ? (
        <>
          {autoConfig && (
            <div className="bg-primary-container/20 rounded-lg p-3 mb-2">
              <p className="body-small text-on-surface-variant">
                已根据岗位和等级自动推荐配置，你可以在下方调整
              </p>
            </div>
          )}

          {/* 模型选择 */}
          <Select
            label="模型"
            value={state.modelId}
            onChange={(v) => update({ modelId: v })}
            options={allModels.map((m: any) => ({ label: `${m.name} (${m.tier || ''})`, value: m.id }))}
          />

          {/* 技能选择 */}
          <div>
            <p className="label-large text-on-surface mb-2">技能</p>
            {allSkills.length === 0 ? (
              <p className="body-small text-on-surface-variant">暂无可用技能</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allSkills.map((sk: any) => {
                  const checked = state.skillIds.includes(sk.id);
                  return (
                    <button
                      key={sk.id}
                      type="button"
                      onClick={() => toggleSkill(sk.id)}
                      className={`px-3 py-1.5 rounded-full label-medium transition-colors border ${
                        checked
                          ? 'bg-primary-container text-on-primary-container border-primary'
                          : 'bg-surface-container text-on-surface-variant border-outline-variant hover:bg-on-surface/[0.04]'
                      }`}
                    >
                      {checked ? '✓ ' : ''}{sk.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* MCP 连接 */}
          <div>
            <p className="label-large text-on-surface mb-2">MCP 连接</p>
            {allMcps.length === 0 ? (
              <p className="body-small text-on-surface-variant">暂无可用 MCP 连接</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allMcps.map((mcp: any) => {
                  const checked = state.mcpIds.includes(mcp.id);
                  return (
                    <button
                      key={mcp.id}
                      type="button"
                      onClick={() => toggleMcp(mcp.id)}
                      className={`px-3 py-1.5 rounded-full label-medium transition-colors border ${
                        checked
                          ? 'bg-secondary-container text-on-secondary-container border-secondary'
                          : 'bg-surface-container text-on-surface-variant border-outline-variant hover:bg-on-surface/[0.04]'
                      }`}
                    >
                      {checked ? '✓ ' : ''}{mcp.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* 模板模式 */
        <div className="space-y-3">
          {templates.length === 0 ? (
            <div className="bg-surface-container rounded-lg p-8 text-center">
              <p className="body-medium text-on-surface-variant">暂无匹配模板</p>
            </div>
          ) : (
            templates.map((tpl: any) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => selectTemplate(tpl)}
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  state.templateId === tpl.id
                    ? 'border-primary bg-primary-container/30 shadow-elevation-1'
                    : 'border-outline-variant bg-surface-container hover:bg-on-surface/[0.04]'
                }`}
              >
                <p className="title-small text-on-surface">{tpl.name}</p>
                <p className="body-small text-on-surface-variant mt-1">{tpl.description || ''}</p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(tpl.skill_ids || tpl.skillIds || []).length > 0 && (
                    <span className="label-small bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded-full">
                      {(tpl.skill_ids || tpl.skillIds).length} 项技能
                    </span>
                  )}
                  {(tpl.mcp_ids || tpl.mcpIds || []).length > 0 && (
                    <span className="label-small bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded-full">
                      {(tpl.mcp_ids || tpl.mcpIds).length} 个 MCP
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );

  const renderStep6 = () => {
    const levelLabel = LEVELS.find((l) => l.value === state.level)?.label || state.level;
    const levelColor = LEVELS.find((l) => l.value === state.level)?.color || '';
    const [promptExpanded, setPromptExpanded] = React.useState(false);

    return (
      <div className="space-y-4">
        <p className="body-medium text-on-surface-variant">确认以下信息无误后，点击「创建」完成</p>

        <div className="bg-surface-container rounded-lg divide-y divide-outline-variant">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="body-medium text-on-surface-variant">岗位</span>
            <span className="body-medium text-on-surface">{state.positionName}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="body-medium text-on-surface-variant">等级</span>
            <span className={`inline-block px-2 py-0.5 rounded-full label-small ${levelColor}`}>{levelLabel}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="body-medium text-on-surface-variant">名称</span>
            <span className="body-medium text-on-surface">{state.name}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="body-medium text-on-surface-variant">模型</span>
            <span className="body-medium text-on-surface">
              {allModels.find((m: any) => m.id === state.modelId)?.name || state.modelId || '未选择'}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="body-medium text-on-surface-variant">技能数</span>
            <span className="body-medium text-on-surface">{state.skillIds.length}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="body-medium text-on-surface-variant">MCP 连接数</span>
            <span className="body-medium text-on-surface">{state.mcpIds.length}</span>
          </div>
        </div>

        {/* 系统提示词折叠展示 */}
        {(state.systemPrompt || promptPreview) && (
          <div className="bg-surface-container rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setPromptExpanded(!promptExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-on-surface/[0.04] transition-colors"
            >
              <span className="body-medium text-on-surface-variant">系统提示词</span>
              <svg
                width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
                className={`text-on-surface-variant transition-transform ${promptExpanded ? 'rotate-180' : ''}`}
              >
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
              </svg>
            </button>
            {promptExpanded && (
              <div className="px-4 pb-3 max-h-48 overflow-y-auto">
                <pre className="body-small text-on-surface whitespace-pre-wrap">
                  {state.systemPrompt || promptPreview}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const currentStep = STEPS.find((s) => s.num === state.step)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center font-roboto">
      <div className="absolute inset-0 bg-scrim/50" onClick={onClose} />
      <div className="relative bg-surface-container-high rounded-xl shadow-elevation-3 w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col animate-modal-in">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h3 className="headline-small text-on-surface">创建数字员工</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.num}>
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center label-small transition-colors ${
                      s.num === state.step
                        ? 'bg-primary text-on-primary'
                        : s.num < state.step
                        ? 'bg-primary/20 text-primary'
                        : 'bg-surface-container-highest text-on-surface-variant'
                    }`}
                  >
                    {s.num < state.step ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                      </svg>
                    ) : (
                      s.num
                    )}
                  </div>
                  <span className={`label-small hidden sm:inline ${
                    s.num === state.step ? 'text-primary' : 'text-on-surface-variant'
                  }`}>
                    {s.title}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-6 h-0.5 ${s.num < state.step ? 'bg-primary/40' : 'bg-outline-variant'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="text-center title-small text-on-surface mt-3 sm:hidden">
            {currentStep.title}
          </p>
        </div>

        {/* 步骤内容 */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {state.step === 1 && renderStep1()}
          {state.step === 2 && renderStep2()}
          {state.step === 3 && renderStep3()}
          {state.step === 4 && renderStep4()}
          {state.step === 5 && renderStep5()}
          {state.step === 6 && renderStep6()}
        </div>

        {/* 底部操作按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-outline-variant">
          <Button
            variant="text"
            onClick={handlePrev}
            disabled={state.step === 1}
          >
            上一步
          </Button>
          <div className="flex gap-2">
            <Button variant="text" onClick={onClose}>取消</Button>
            {state.step < 6 ? (
              <Button variant="filled" onClick={handleNext} disabled={!canNext()}>
                下一步
              </Button>
            ) : (
              <Button variant="filled" onClick={handleCreate} disabled={creating}>
                {creating ? '创建中...' : '创建'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes modal-in { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
        .animate-modal-in { animation: modal-in 200ms ease-out; }
      `}</style>

      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default PersonaWizard;
