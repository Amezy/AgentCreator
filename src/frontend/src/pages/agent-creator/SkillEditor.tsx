import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { skillApi, positionApi, mcpApi } from '../../services/agentCreatorApi';
import './SkillEditor.css';
import SkillTemplateSelector from './components/SkillTemplateSelector';
import AIChatPanel from './components/AIChatPanel';
import { TOOL_DISPLAY_MAP, getToolDisplay, groupToolsByCategory } from '../../constants/toolDisplayMap';

interface ToolItem {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface PositionItem {
  id: string;
  name: string;
  category: string;
}

interface McpConnection {
  id: string;
  name: string;
  description?: string;
}

interface SkillForm {
  name: string;
  description: string;
  category: string;
  complexity: string;
  recommended_model_tier: string;
  instructions: string;
  opencode_tools: string[];
  mcp_ids: string[];
  applicable_positions: string[];
  applicable_min_level: string;
}

const EMPTY_FORM: SkillForm = {
  name: '', description: '', category: 'engineering', complexity: 'basic',
  recommended_model_tier: 'basic', instructions: '', opencode_tools: [],
  mcp_ids: [], applicable_positions: [], applicable_min_level: 'junior',
};

const CATEGORY_OPTIONS = [
  { label: '工程', value: 'engineering' },
  { label: '咨询', value: 'consulting' },
  { label: '通用', value: 'general' },
];
const COMPLEXITY_OPTIONS = [
  { label: '基础', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '复杂', value: 'complex' },
  { label: '特殊', value: 'special' },
];
const TIER_OPTIONS = [
  { label: '基础', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '高级', value: 'advanced' },
];
const LEVEL_OPTIONS = [
  { label: '初级', value: 'junior' },
  { label: '中级', value: 'mid' },
  { label: '高级', value: 'senior' },
  { label: '专家', value: 'expert' },
];

const SkillEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !id;
  const mode = searchParams.get('mode') || 'manual';

  const [form, setForm] = useState<SkillForm>({ ...EMPTY_FORM });
  const [availableTools, setAvailableTools] = useState<ToolItem[]>([]);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(mode === 'ai');
  const [skillVersion, setSkillVersion] = useState(1);
  const [isPreset, setIsPreset] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [aiStep, setAiStep] = useState(1);
  const snackbarTimerRef = React.useRef<ReturnType<typeof setTimeout>>();

  const showSnackbar = useCallback((message: string) => {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    setSnackbar({ open: true, message });
    snackbarTimerRef.current = setTimeout(() => setSnackbar({ open: false, message: '' }), 3000);
  }, []);

  useEffect(() => {
    if (id) {
      setLoading(true);
      skillApi.get(id).then((data) => {
        setForm({
          name: data.name || '', description: data.description || '',
          category: data.category || 'engineering', complexity: data.complexity || 'basic',
          recommended_model_tier: data.recommended_model_tier || 'basic',
          instructions: data.instructions || '',
          opencode_tools: data.opencode_tools ? JSON.parse(data.opencode_tools) : [],
          mcp_ids: data.mcp_ids ? JSON.parse(data.mcp_ids) : [],
          applicable_positions: data.applicable_positions ? JSON.parse(data.applicable_positions) : [],
          applicable_min_level: data.applicable_min_level || 'junior',
        });
        setSkillVersion(data.version || 1);
        setIsPreset(data.is_preset || false);
      }).catch((err) => {
        showSnackbar('加载技能失败: ' + err.message);
      }).finally(() => setLoading(false));
    }
  }, [id]);

  useEffect(() => {
    skillApi.availableTools().then(setAvailableTools).catch(() => {});
    positionApi.list().then(setPositions).catch(() => {});
    mcpApi.list().then(setMcpConnections).catch(() => {});
  }, []);

  // 当新建技能且为手动模式时，显示模板选择器
  useEffect(() => {
    if (!id && searchParams.get('mode') === 'manual') {
      setShowTemplateSelector(true);
    }
  }, [id, searchParams]);

  const updateForm = useCallback((patch: Partial<SkillForm>) => {
    setForm(prev => ({ ...prev, ...patch }));
  }, []);

  const toggleTool = (toolId: string) => {
    setForm(prev => ({
      ...prev,
      opencode_tools: prev.opencode_tools.includes(toolId)
        ? prev.opencode_tools.filter(t => t !== toolId)
        : [...prev.opencode_tools, toolId],
    }));
  };

  const handleTemplateSelect = (template: { name: string; default_tools: string[]; default_instructions: string; category: string }) => {
    setForm(prev => ({
      ...prev,
      category: template.category as SkillForm['category'],
      instructions: template.default_instructions,
      opencode_tools: template.default_tools,
    }));
    setShowTemplateSelector(false);
  };

  const handleAIFormUpdate = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleAIToolsSuggest = (tools: string[]) => {
    setForm(prev => ({ ...prev, opencode_tools: tools }));
  };

  const handleAIInstructionsUpdate = (content: string) => {
    setForm(prev => ({ ...prev, instructions: content }));
  };

  const handleAIStepComplete = (nextStep: number) => {
    setAiStep(nextStep);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      showSnackbar('请输入技能名称'); return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (isNew) {
        const created = await skillApi.create(payload);
        showSnackbar('技能创建成功');
        navigate(`/agent-creator/skills/${created.id}/edit`, { replace: true });
      } else {
        const updated = await skillApi.update(id!, payload);
        showSnackbar('技能保存成功');
        setSkillVersion(updated.version || skillVersion + 1);
      }
    } catch (err: any) {
      showSnackbar(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!id) return;
    try {
      const content = await skillApi.export(id);
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.name || 'skill'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showSnackbar('导出失败: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="skill-editor flex items-center justify-center">
        <p className="text-on-surface-variant">加载中...</p>
      </div>
    );
  }

  if (showTemplateSelector) {
    return (
      <div className="skill-editor">
        <SkillTemplateSelector
          onSelect={handleTemplateSelect}
          onCancel={() => {
            setShowTemplateSelector(false);
            navigate('/agent-creator/resources');
          }}
        />
      </div>
    );
  }

  return (
    <div className="skill-editor">
      {/* Toolbar */}
      <div className="skill-editor-toolbar">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/agent-creator/resources')}
            className="p-1.5 rounded-lg hover:bg-on-surface/[0.08] text-on-surface-variant" title="返回">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          <span className="title-medium text-on-surface">{isNew ? '创建技能' : form.name || '编辑技能'}</span>
          {!isNew && <span className="label-small text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">v{skillVersion}</span>}
          {isPreset && <span className="label-small text-on-tertiary-container bg-tertiary-container px-2 py-0.5 rounded">预置</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAiPanel(!showAiPanel)}
            className={`px-3 py-1.5 rounded-lg label-medium transition-colors ${showAiPanel ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'}`}>
            AI 助手
          </button>
          {!isNew && (
            <button onClick={handleExport}
              className="px-3 py-1.5 rounded-lg label-medium bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]">
              导出 SKILL.md
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 rounded-lg label-medium bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="skill-editor-body">
        {/* Left sidebar */}
        <div className="skill-editor-sidebar space-y-5">
          <section>
            <h4 className="label-large text-on-surface-variant mb-3">基本信息</h4>
            <div className="space-y-3">
              <div>
                <label className="label-small text-on-surface-variant block mb-1">名称 *</label>
                <input value={form.name} onChange={e => updateForm({ name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-medium border border-outline-variant focus:border-primary outline-none"
                  placeholder="如：代码审查" />
              </div>
              <div>
                <label className="label-small text-on-surface-variant block mb-1">描述</label>
                <textarea value={form.description} onChange={e => updateForm({ description: e.target.value })}
                  rows={3} maxLength={1024}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-small border border-outline-variant focus:border-primary outline-none resize-none"
                  placeholder="简短描述技能的用途..." />
              </div>
              <div>
                <label className="label-small text-on-surface-variant block mb-1">分类</label>
                <select value={form.category} onChange={e => updateForm({ category: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-medium border border-outline-variant focus:border-primary outline-none">
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label-small text-on-surface-variant block mb-1">复杂度</label>
                  <select value={form.complexity} onChange={e => updateForm({ complexity: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface-container-highest text-on-surface body-small border border-outline-variant focus:border-primary outline-none">
                    {COMPLEXITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-small text-on-surface-variant block mb-1">模型等级</label>
                  <select value={form.recommended_model_tier} onChange={e => updateForm({ recommended_model_tier: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface-container-highest text-on-surface body-small border border-outline-variant focus:border-primary outline-none">
                    {TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label-small text-on-surface-variant block mb-1">最低使用等级</label>
                <select value={form.applicable_min_level} onChange={e => updateForm({ applicable_min_level: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-medium border border-outline-variant focus:border-primary outline-none">
                  {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section>
            <h4 className="label-large text-on-surface-variant mb-3">绑定工具 <span className="label-small text-on-surface-variant ml-1">({form.opencode_tools.length} 已选)</span></h4>
            <div className="space-y-2">
              {Object.entries(
                groupToolsByCategory(availableTools.map(t => t.id))
              ).map(([category, tools]) => (
                <div key={category} className="mb-3">
                  <p className="label-small text-on-surface-variant/70 mb-1.5">{category}</p>
                  {tools.map(({ id: toolId, display }) => (
                    <label
                      key={toolId}
                      className="flex items-center gap-2 py-1 px-1 rounded hover:bg-on-surface/[0.04] cursor-pointer"
                      title={`${toolId} — ${display.description}`}
                    >
                      <input
                        type="checkbox"
                        checked={form.opencode_tools.includes(toolId)}
                        onChange={() => toggleTool(toolId)}
                        className="rounded border-outline-variant"
                      />
                      <span className="label-small text-on-surface">
                        {display.icon} {display.label}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              {availableTools.length === 0 && <p className="body-small text-on-surface-variant/50">加载工具列表中...</p>}
            </div>
          </section>

          <section>
            <h4 className="label-large text-on-surface-variant mb-3">MCP 连接 <span className="label-small text-on-surface-variant ml-1">({form.mcp_ids.length} 已选)</span></h4>
            <div className="flex flex-wrap gap-1">
              {mcpConnections.map(mcp => (
                <button key={mcp.id}
                  onClick={() => setForm(prev => ({
                    ...prev, mcp_ids: prev.mcp_ids.includes(mcp.id)
                      ? prev.mcp_ids.filter(m => m !== mcp.id)
                      : [...prev.mcp_ids, mcp.id],
                  }))}
                  title={mcp.description || mcp.name}
                  className={`px-2 py-0.5 rounded label-small transition-colors ${
                    form.mcp_ids.includes(mcp.id)
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                  }`}>{mcp.name}</button>
              ))}
              {mcpConnections.length === 0 && <p className="body-small text-on-surface-variant/50">暂无 MCP 连接</p>}
            </div>
          </section>

          <section>
            <h4 className="label-large text-on-surface-variant mb-3">适用范围</h4>
            <div>
              <p className="label-small text-on-surface-variant/70 mb-1">适用岗位</p>
              <div className="flex flex-wrap gap-1">
                {positions.map(pos => (
                  <button key={pos.id}
                    onClick={() => setForm(prev => ({
                      ...prev, applicable_positions: prev.applicable_positions.includes(pos.id)
                        ? prev.applicable_positions.filter(p => p !== pos.id)
                        : [...prev.applicable_positions, pos.id],
                    }))}
                    className={`px-2 py-0.5 rounded label-small transition-colors ${
                      form.applicable_positions.includes(pos.id)
                        ? 'bg-tertiary-container text-on-tertiary-container'
                        : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                    }`}>{pos.name}</button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Center editor */}
        <div className="skill-editor-main">
          <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/50">
            <div className="flex items-center gap-2">
              <button onClick={() => setPreviewMode(false)}
                className={`px-3 py-1 rounded label-medium ${!previewMode ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-on-surface/[0.08]'}`}>
                编辑
              </button>
              <button onClick={() => setPreviewMode(true)}
                className={`px-3 py-1 rounded label-medium ${previewMode ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-on-surface/[0.08]'}`}>
                预览
              </button>
            </div>
            <span className="label-small text-on-surface-variant/50">{form.instructions.split('\n').length} 行</span>
          </div>
          {previewMode ? (
            <div className="skill-instructions-preview text-on-surface"
              dangerouslySetInnerHTML={{ __html: simpleMarkdown(form.instructions) }} />
          ) : (
            <textarea value={form.instructions} onChange={e => updateForm({ instructions: e.target.value })}
              className="skill-instructions-editor"
              placeholder={'在这里编写技能指令（Markdown 格式）...\n\n# 技能名称\n\n## 执行流程\n1. 第一步\n2. 第二步\n\n## 输出格式\n- 格式要求...'}
              spellCheck={false} />
          )}
        </div>

        {/* Right AI panel */}
        <div className={`skill-editor-ai-panel ${showAiPanel ? '' : 'collapsed'}`}>
          {showAiPanel && (
            <AIChatPanel
              step={aiStep}
              currentSkill={form as unknown as Record<string, unknown>}
              onFormUpdate={handleAIFormUpdate}
              onToolsSuggest={handleAIToolsSuggest}
              onInstructionsUpdate={handleAIInstructionsUpdate}
              onStepComplete={handleAIStepComplete}
            />
          )}
        </div>
      </div>

      {snackbar.open && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-lg shadow-lg body-medium z-50">
          {snackbar.message}
          <button onClick={() => setSnackbar({ open: false, message: '' })} className="ml-3 text-inverse-primary label-medium">关闭</button>
        </div>
      )}
    </div>
  );
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function simpleMarkdown(md: string): string {
  if (!md) return '<p class="text-on-surface-variant/50">暂无指令内容</p>';
  // Escape first, then apply Markdown transforms on escaped content
  let html = escapeHtml(md)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  html = html.replace(/(<li>.*?<\/li>(?:<br\/>)?)+/g, (match) => {
    return '<ul>' + match.replace(/<br\/>/g, '') + '</ul>';
  });
  // Sanitize: strip any tags that weren't produced by the transforms above
  const allowedTags = ['h1', 'h2', 'h3', 'p', 'strong', 'code', 'li', 'ul', 'br'];
  const tagPattern = allowedTags.map(t => `${t}`).join('|');
  const allowedRegex = new RegExp(`<\\/?(${tagPattern})(\\s?\\/?)>`, 'g');
  // Collect allowed tag positions
  const allowed = new Set<string>();
  html.replace(allowedRegex, (match) => { allowed.add(match); return match; });
  // Remove any HTML tag not in the allowed set
  html = html.replace(/<\/?[a-zA-Z][^>]*>/g, (match) => allowed.has(match) ? match : escapeHtml(match));
  return '<p>' + html + '</p>';
}

export default SkillEditor;
