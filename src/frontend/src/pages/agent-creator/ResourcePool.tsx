/**
 * @module ResourcePool
 * @description 资源池页面 - 管理模型、技能和 MCP 连接三类资源。
 * 通过顶部 Tab 切换不同资源类型的列表和管理界面。
 * 每个 Tab 包含：统计概览、过滤器、数据表格、新增/编辑弹窗。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Tabs from '../../components/m3/Tabs';
import Button from '../../components/m3/Button';
import TextField from '../../components/m3/TextField';
import TextArea from '../../components/m3/TextArea';
import Snackbar from '../../components/m3/Snackbar';
import { modelApi, skillApi, mcpApi, marketApi } from '../../services/agentCreatorApi';

// ===== 类型定义 =====

interface ModelItem {
  id: string;
  name: string;
  provider: string;
  model_version: string;
  model_id: string;
  auth_method: string;
  api_key_enc?: string;
  quota_type: string;
  quota_total: number;
  quota_used: number;
  health_status: string;
  is_active: number;
}

interface SkillItem {
  id: string;
  name: string;
  category: 'engineering' | 'consulting' | 'general';
  complexity: 'basic' | 'medium' | 'complex' | 'special';
  recommended_model_tier: string;
  description: string;
  instructions?: string;
  opencode_tools?: string;
  mcp_ids?: string;
  version?: number;
  is_active?: boolean;
  is_preset: boolean;
}

interface McpItem {
  id: string;
  name: string;
  description?: string;
  connection_type: 'stdio' | 'sse';
  // SSE/HTTP mode
  server_url?: string;
  auth_type?: string;
  headers?: Record<string, string> | null;
  // Stdio mode
  command?: string;
  args?: string[] | null;
  env?: Record<string, string> | null;
  // Status
  health_status: string;
  last_health_check?: string;
  is_active: boolean;
}

// ===== 常量 =====

const RESOURCE_TABS = [
  { label: '模型池', value: 'models' },
  { label: 'MCP 连接池', value: 'mcp' },
  { label: '技能池', value: 'skills' },
];

const PROVIDER_OPTIONS = [
  { label: 'Claude', value: 'Claude' },
  { label: '智谱', value: '智谱' },
  { label: 'Google', value: 'Google' },
];

const MODEL_VERSIONS: Record<string, { label: string; value: string }[]> = {
  Claude: [
    { label: 'Opus 4.6', value: 'claude-opus-4-6' },
    { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
    { label: 'Haiku 4.6', value: 'claude-haiku-4-6' },
  ],
  '智谱': [
    { label: 'GLM-5', value: 'glm-5' },
    { label: 'GLM-4.7', value: 'glm-4.7' },
    { label: 'GLM-4.7-Flash', value: 'glm-4.7-flash' },
  ],
  Google: [
    { label: 'Gemini 3 Pro', value: 'gemini-3-pro' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash' },
    { label: 'Gemini 3 Flash Lite', value: 'gemini-3-flash-lite' },
  ],
};

const AUTH_METHOD_OPTIONS = [
  { label: 'API Key', value: 'api_key' },
  { label: 'Claude CLI 认证', value: 'cli_auth' },
];

const QUOTA_TYPE_OPTIONS = [
  { label: '包月（不限量）', value: 'monthly' },
  { label: 'Token 数限额', value: 'token_limit' },
  { label: '费用限额（元）', value: 'cost_limit' },
];
const CATEGORY_OPTIONS = [
  { label: '工程', value: 'engineering' },
  { label: '咨询', value: 'consulting' },
  { label: '通用', value: 'general' },
];
const COMPLEXITY_OPTIONS = [
  { label: '一般', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '复杂', value: 'complex' },
  { label: '特殊', value: 'special' },
];
const AUTH_TYPE_OPTIONS = [
  { label: '无认证', value: 'none' },
  { label: 'API Key', value: 'api_key' },
  { label: 'Bearer Token', value: 'bearer' },
];

const PROVIDER_LABEL: Record<string, string> = { Claude: 'Claude', '智谱': '智谱', Google: 'Google' };
const TIER_LABEL: Record<string, string> = { advanced: '高级', medium: '中级', basic: '基础' };
const TIER_OPTIONS = [
  { label: '高级', value: 'advanced' },
  { label: '中级', value: 'medium' },
  { label: '基础', value: 'basic' },
];
const CATEGORY_LABEL: Record<string, string> = { engineering: '工程', consulting: '咨询', general: '通用' };
const COMPLEXITY_ICON: Record<string, string> = { basic: '🟢 一般', medium: '🟡 中等', complex: '🔴 复杂', special: '⭐ 特殊' };
const STATUS_ICON: Record<string, string> = { healthy: '✅', error: '❌', unknown: '⚪', connected: '✅', disconnected: '❌' };

// ===== 通用弹窗 =====

const Modal: React.FC<{ open: boolean; title: string; onClose: () => void; children: React.ReactNode }> = ({
  open, title, onClose, children,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/40" onClick={onClose} />
      <div className="relative bg-surface-container-high rounded-xl shadow-elevation-3 w-[480px] max-h-[85vh] flex flex-col animate-dialog-in">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-outline-variant shrink-0">
          <h3 className="text-lg font-medium text-on-surface">{title}</h3>
          <button type="button" onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {children}
        </div>
      </div>
      <style>{`
        @keyframes dialog-in { from { opacity:0; transform:scale(0.96) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .animate-dialog-in { animation: dialog-in 200ms ease-out; }
      `}</style>
    </div>
  );
};

// ===== 通用下拉选择 =====

const Select: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  className?: string;
}> = ({ label, value, onChange, options, className = '' }) => (
  <div className={`w-full font-roboto ${className}`}>
    <label className="block text-xs font-medium text-on-surface-variant mb-1.5">{label}</label>
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-12 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none appearance-none cursor-pointer hover:border-outline focus:border-primary focus:border-2 transition-colors"
      >
        <option value="">请选择</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 10l5 5 5-5z"/>
      </svg>
    </div>
  </div>
);

// ===== 进度条 =====

const ProgressBar: React.FC<{ used: number; total: number }> = ({ used, total }) => {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = pct > 80 ? 'bg-error' : pct > 50 ? 'bg-tertiary' : 'bg-primary';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-on-surface-variant whitespace-nowrap tabular-nums">{used}/{total}</span>
    </div>
  );
};

// ===== 确认弹窗 =====

const ConfirmDialog: React.FC<{ open?: boolean; title?: string; message: string; onConfirm: () => void; onCancel: () => void }> = ({
  open, title, message, onConfirm, onCancel,
}) => {
  if (open === false) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/40" onClick={onCancel} />
      <div className="relative bg-surface-container-high rounded-xl shadow-elevation-3 p-6 w-[400px] animate-dialog-in">
        {title && <h3 className="text-base font-medium text-on-surface mb-3">{title}</h3>}
        <p className="text-sm text-on-surface mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onCancel}>取消</Button>
          <Button variant="filled" onClick={onConfirm}>确认删除</Button>
        </div>
      </div>
    </div>
  );
};

// ==============================
// 模型池 Tab
// ==============================

const ModelTab: React.FC = () => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ModelItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelItem | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formProvider, setFormProvider] = useState('');
  const [formModelVersion, setFormModelVersion] = useState('');
  const [formAuthMethod, setFormAuthMethod] = useState('api_key');
  const [formApiKey, setFormApiKey] = useState('');
  const [formQuotaType, setFormQuotaType] = useState('monthly');
  const [formQuota, setFormQuota] = useState('1000');

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await modelApi.list();
      setModels(data || []);
    } catch {
      // API 尚未实现时使用空列表
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const resetForm = () => {
    setFormProvider('Claude'); setFormModelVersion(''); setFormName('');
    setFormAuthMethod('cli_auth'); setFormApiKey('');
    setFormQuotaType('monthly'); setFormQuota('1000');
    setEditingItem(null);
  };

  const openCreate = () => { resetForm(); setShowModal(true); };
  const openEdit = (item: ModelItem) => {
    setEditingItem(item);
    setFormName(item.name); setFormProvider(item.provider);
    setFormModelVersion(item.model_version || '');
    setFormAuthMethod(item.auth_method || 'api_key'); setFormApiKey(item.api_key_enc || '');
    setFormQuotaType(item.quota_type || 'monthly'); setFormQuota(String(item.quota_total));
    setShowModal(true);
  };

  // 根据供应商+模型版本自动生成模型ID
  const autoModelId = formModelVersion || '';
  // 自动生成显示名称：供应商 + 版本标签
  const versionLabel = MODEL_VERSIONS[formProvider]?.find(v => v.value === formModelVersion)?.label || '';

  const handleSave = async () => {
    if (!formName || !formProvider || !formModelVersion) {
      setSnackbar({ open: true, message: '请填写必填项（名称、供应商、模型版本）' }); return;
    }
    if (formAuthMethod === 'api_key' && !formApiKey) {
      setSnackbar({ open: true, message: '请填写 API Key' }); return;
    }
    const payload = {
      name: formName,
      provider: formProvider,
      model_version: formModelVersion,
      model_id: autoModelId,
      auth_method: formAuthMethod,
      api_key: formAuthMethod === 'api_key' ? formApiKey : '',
      quota_type: formQuotaType,
      quota_total: formQuotaType === 'monthly' ? 0 : Number(formQuota),
    };
    try {
      if (editingItem) {
        await modelApi.update(editingItem.id, payload);
        setSnackbar({ open: true, message: '模型更新成功' });
      } else {
        await modelApi.create(payload);
        setSnackbar({ open: true, message: '模型创建成功' });
      }
      setShowModal(false); resetForm(); fetchModels();
      // 后台会自动执行健康检查，延迟刷新以获取最新状态
      if (!editingItem) setTimeout(fetchModels, 3000);
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '操作失败' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await modelApi.delete(deleteTarget.id);
      setSnackbar({ open: true, message: '模型已删除' });
      fetchModels();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '删除失败' });
    }
    setDeleteTarget(null);
  };

  const handleHealthCheck = async (item: ModelItem) => {
    setCheckingId(item.id);
    try {
      const result = await modelApi.healthCheck(item.id);
      setSnackbar({ open: true, message: `健康检查完成：${result?.status === 'healthy' ? '正常' : '异常'}` });
      fetchModels();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '健康检查失败' });
    }
    setCheckingId(null);
  };

  const healthyCount = models.filter((m) => m.health_status === 'healthy').length;

  return (
    <div className="space-y-4">
      {/* 统计 + 操作栏 */}
      <div className="flex items-center justify-between">
        <p className="body-medium text-on-surface-variant">
          共 <span className="text-on-surface font-medium">{models.length}</span> 个模型，
          <span className="text-on-surface font-medium">{healthyCount}</span> 个健康
        </p>
        <Button variant="filled" onClick={openCreate} icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        }>新增模型</Button>
      </div>

      {/* 表格 */}
      {loading ? (
        <div className="bg-surface-container rounded-lg p-12 text-center">
          <p className="body-medium text-on-surface-variant">加载中...</p>
        </div>
      ) : models.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 text-center">
          <p className="body-medium text-on-surface-variant">暂无模型，点击「新增模型」添加</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-outline-variant">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant">
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium">名称</th>
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium">供应商</th>
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium">模型</th>
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium">认证</th>
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium">状态</th>
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium">配额</th>
                <th className="px-4 py-3 label-large text-on-surface-variant font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-b border-outline-variant last:border-b-0 hover:bg-on-surface/[0.04] transition-colors">
                  <td className="px-4 py-3 body-medium text-on-surface">{m.name}</td>
                  <td className="px-4 py-3 body-medium text-on-surface">{PROVIDER_LABEL[m.provider] || m.provider}</td>
                  <td className="px-4 py-3 body-small text-on-surface-variant">{m.model_id}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full label-small ${
                      m.auth_method === 'cli_auth' ? 'bg-primary-container text-on-primary-container' :
                      'bg-surface-container-highest text-on-surface-variant'
                    }`}>{m.auth_method === 'cli_auth' ? 'CLI 认证' : 'API Key'}</span>
                  </td>
                  <td className="px-4 py-3 body-medium">
                    {STATUS_ICON[m.health_status] || '⚪'} {m.health_status === 'healthy' ? '健康' : m.health_status === 'unhealthy' ? '异常' : '未知'}
                  </td>
                  <td className="px-4 py-3">
                    {m.quota_type === 'monthly' ? (
                      <span className="label-small text-primary">包月</span>
                    ) : (
                      <ProgressBar used={m.quota_used || 0} total={m.quota_total || 1000} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(m)} className="p-2 rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant" title="编辑">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHealthCheck(m)}
                        disabled={checkingId === m.id}
                        className="p-2 rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant disabled:opacity-40"
                        title="健康检查"
                      >
                        {checkingId === m.id ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="animate-spin"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                        )}
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(m)} className="p-2 rounded-full hover:bg-error/[0.08] text-error" title="删除">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal open={showModal} title={editingItem ? '编辑模型' : '新增模型'} onClose={() => { setShowModal(false); resetForm(); }}>
        <div className="space-y-4">
          <Select label="供应商" value={formProvider} onChange={(v) => {
            setFormProvider(v);
            setFormModelVersion('');
            setFormName('');
            if (v === 'Claude') setFormAuthMethod('cli_auth');
            else setFormAuthMethod('api_key');
          }} options={PROVIDER_OPTIONS} />

          {MODEL_VERSIONS[formProvider] && (
            <Select label="模型版本" value={formModelVersion} onChange={(v) => {
              setFormModelVersion(v);
              const label = MODEL_VERSIONS[formProvider]?.find(m => m.value === v)?.label || '';
              setFormName(`AIBox-${formProvider}-${label}`);
            }} options={MODEL_VERSIONS[formProvider]} />
          )}

          {formModelVersion && (
            <TextField label="模型名称" value={formName} onChange={setFormName}
              helperText="自动生成，可手动修改" />
          )}

          {formProvider === 'Claude' && (
            <Select label="认证方式" value={formAuthMethod} onChange={setFormAuthMethod}
              options={AUTH_METHOD_OPTIONS} />
          )}

          {formAuthMethod === 'cli_auth' && formProvider === 'Claude' ? (
            <div className="rounded-lg bg-primary-container/20 border border-outline-variant p-4 space-y-2">
              <div className="flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-primary shrink-0"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
                <p className="text-sm font-medium text-on-surface">Claude CLI 认证</p>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                通过 Box System 的 OAuth PKCE 流程完成认证，无需手动填写 API Key。
              </p>
              <Button variant="tonal" className="mt-1" onClick={() => {
                setSnackbar({ open: true, message: 'CLI 认证功能将在后续版本中集成' });
              }}>启动 CLI 认证</Button>
            </div>
          ) : (
            <TextField label="API Key" type="password" value={formApiKey} onChange={setFormApiKey} />
          )}

          <Select label="配额方式" value={formQuotaType} onChange={setFormQuotaType}
            options={QUOTA_TYPE_OPTIONS} />

          {formQuotaType === 'token_limit' && (
            <TextField label="Token 数限额" value={formQuota} onChange={setFormQuota}
              helperText="最大可用 Token 数量（如 1000000）" />
          )}
          {formQuotaType === 'cost_limit' && (
            <TextField label="费用限额（元）" value={formQuota} onChange={setFormQuota}
              helperText="最大可用费用（人民币）" />
          )}
          {formQuotaType === 'monthly' && (
            <div className="rounded-lg bg-tertiary-container/20 border border-outline-variant px-4 py-3">
              <p className="text-xs text-on-surface-variant">包月模式：不限制用量，按月计费</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="text" onClick={() => { setShowModal(false); resetForm(); }}>取消</Button>
            <Button variant="filled" onClick={handleSave}>{editingItem ? '保存' : '创建'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        message={`确定要删除模型「${deleteTarget?.name}」吗？此操作不可撤销。`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <Snackbar message={snackbar.message} open={snackbar.open} onClose={() => setSnackbar({ open: false, message: '' })} />
    </div>
  );
};

// ==============================
// 技能池 Tab
// ==============================

const SkillTab: React.FC = () => {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SkillItem | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  const [filterCategory, setFilterCategory] = useState('');
  const [filterComplexity, setFilterComplexity] = useState('');
  const [filterPreset, setFilterPreset] = useState('');

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterCategory) params.category = filterCategory;
      if (filterComplexity) params.complexity = filterComplexity;
      if (filterPreset) params.is_preset = filterPreset;
      const data = await skillApi.list(Object.keys(params).length ? params : undefined);
      setSkills(data || []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterComplexity, filterPreset]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setShowCreateMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleUploadSkillMd = async () => {
    setShowCreateMenu(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const parsed = await skillApi.parseSkillMd(file);
        const created = await skillApi.create(parsed);
        navigate(`/agent-creator/skills/${created.id}/edit`);
        setSnackbar({ open: true, message: 'SKILL.md 解析成功，已进入编辑器' });
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || '解析失败' });
      }
    };
    input.click();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await skillApi.delete(deleteTarget.id);
      setSnackbar({ open: true, message: '技能已删除' });
      fetchSkills();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '删除失败' });
    }
    setDeleteTarget(null);
  };

  const filteredSkills = skills;
  const presetCount = skills.filter((s) => s.is_preset).length;

  const parseTools = (toolsJson?: string): string[] => {
    if (!toolsJson) return [];
    try { return JSON.parse(toolsJson); } catch { return []; }
  };

  // 按分类分组
  const CATEGORY_GROUP_ORDER: { key: string; label: string; icon: string; color: string }[] = [
    { key: 'engineering', label: '工程技能', icon: '{ }', color: 'text-primary' },
    { key: 'consulting', label: '咨询技能', icon: '|||', color: 'text-secondary' },
    { key: 'general', label: '通用技能', icon: '***', color: 'text-outline' },
  ];
  const grouped = CATEGORY_GROUP_ORDER.map(g => ({
    ...g,
    skills: filteredSkills.filter(s => s.category === g.key),
  })).filter(g => g.skills.length > 0);

  const renderSkillCard = (s: SkillItem) => {
    const tools = parseTools(s.opencode_tools);
    const mcpIds = parseTools(s.mcp_ids);
    return (
      <div key={s.id} onClick={() => navigate(`/agent-creator/skills/${s.id}/edit`)}
        className="group relative bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-4 cursor-pointer transition-all hover:shadow-elevation-1 hover:border-primary/40">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="title-small text-on-surface font-medium truncate">{s.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 ml-2 shrink-0">
            {s.version && s.version > 1 && (
              <span className="label-small text-outline">v{s.version}</span>
            )}
            {s.is_preset && (
              <span className="px-1.5 py-0.5 rounded label-small bg-primary-container/60 text-on-primary-container">预置</span>
            )}
          </div>
        </div>
        <p className="body-small text-on-surface-variant line-clamp-2 mb-3 min-h-[2.5em]">
          {s.description || '暂无描述'}
        </p>
        {(tools.length > 0 || mcpIds.length > 0) && (
          <div className="flex flex-wrap gap-1 mb-3">
            {tools.slice(0, 5).map((t) => (
              <span key={t} className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">{t}</span>
            ))}
            {tools.length > 5 && (
              <span className="inline-block px-1.5 py-0.5 rounded text-xs text-outline bg-surface-container">+{tools.length - 5}</span>
            )}
            {mcpIds.map((m, i) => (
              <span key={`mcp-${i}`} className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">MCP</span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-outline-variant/30">
          <span className="label-small text-outline">
            {COMPLEXITY_OPTIONS.find(c => c.value === s.complexity)?.label || s.complexity}
            {' / '}
            {TIER_LABEL[s.recommended_model_tier] || s.recommended_model_tier}
          </span>
          {!s.is_preset && (
            <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-error-container" title="删除技能">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-error">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header: Stats + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="body-medium text-on-surface-variant">
            共 <span className="text-on-surface font-medium">{skills.length}</span> 个技能
            <span className="mx-1.5 text-outline-variant">|</span>
            <span className="text-on-surface font-medium">{presetCount}</span> 预置
            <span className="mx-1 text-outline-variant">/</span>
            <span className="text-on-surface font-medium">{skills.length - presetCount}</span> 自定义
          </p>
        </div>
        <div className="relative" ref={createMenuRef}>
          <Button variant="filled" onClick={() => setShowCreateMenu(!showCreateMenu)} icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          }>创建技能</Button>
          {showCreateMenu && (
            <div className="absolute right-0 top-full mt-1 bg-surface-container-lowest rounded-xl shadow-elevation-2 border border-outline-variant/50 z-10 min-w-[200px] py-1.5">
              <button className="w-full px-4 py-2.5 text-left body-medium text-on-surface hover:bg-primary-container/30 transition-colors"
                onClick={() => { setShowCreateMenu(false); navigate('/agent-creator/skills/new?mode=ai'); }}>
                AI 辅助创建
              </button>
              <button className="w-full px-4 py-2.5 text-left body-medium text-on-surface hover:bg-primary-container/30 transition-colors"
                onClick={() => { setShowCreateMenu(false); navigate('/agent-creator/skills/new?mode=manual'); }}>
                手动编写
              </button>
              <div className="mx-3 my-1 border-t border-outline-variant/30" />
              <button className="w-full px-4 py-2.5 text-left body-medium text-on-surface hover:bg-primary-container/30 transition-colors"
                onClick={handleUploadSkillMd}>
                上传 SKILL.md
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="w-36">
          <Select label="分类" value={filterCategory} onChange={setFilterCategory}
            options={[{ label: '全部分类', value: '' }, ...CATEGORY_OPTIONS]} />
        </div>
        <div className="w-36">
          <Select label="复杂度" value={filterComplexity} onChange={setFilterComplexity}
            options={[{ label: '全部', value: '' }, ...COMPLEXITY_OPTIONS]} />
        </div>
        <div className="w-36">
          <Select label="类型" value={filterPreset} onChange={setFilterPreset}
            options={[{ label: '全部', value: '' }, { label: '预置', value: 'true' }, { label: '自定义', value: 'false' }]} />
        </div>
      </div>

      {/* Grouped card grid */}
      {loading ? (
        <div className="bg-surface-container rounded-xl p-12 text-center">
          <p className="body-medium text-on-surface-variant">加载中...</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="bg-surface-container rounded-xl p-12 text-center">
          <p className="body-medium text-on-surface-variant">暂无技能，点击「创建技能」添加</p>
        </div>
      ) : filterCategory ? (
        /* 筛选了特定分类时，不分组直接展示 */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredSkills.map(renderSkillCard)}
        </div>
      ) : (
        /* 未筛选分类时，按分类分组展示 */
        <div className="space-y-6">
          {grouped.map(g => (
            <section key={g.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`title-small font-medium ${g.color}`}>{g.label}</span>
                <span className="label-small text-outline">({g.skills.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {g.skills.map(renderSkillCard)}
              </div>
            </section>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog title="确认删除"
          message={`确定要删除技能「${deleteTarget.name}」吗？此操作不可撤销。`}
          onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
      <Snackbar message={snackbar.message} open={snackbar.open} onClose={() => setSnackbar({ open: false, message: '' })} />
    </div>
  );
};

// ==============================
// ==============================
// 市场浏览弹窗 (参照 WorkX MarketBrowseModal)
// ==============================

interface MarketItem {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon?: string;
  category: string;
  tags: string[];
  installCount: number;
  rating: number;
}

interface MarketConfigField {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'select';
  required: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

interface MarketVariant {
  id: string;
  label: string;
  description?: string;
  installConfig: { command: string; args: string[]; env?: Record<string, string> };
  fields?: MarketConfigField[];
}

interface MarketItemDetail extends MarketItem {
  longDescription?: string;
  installConfig: { command: string; args: string[]; env?: Record<string, string> };
  userConfigSchema?: {
    fields?: MarketConfigField[];
    variants?: MarketVariant[];
  };
  docsUrl?: string;
  repositoryUrl?: string;
}

const MarketBrowseModal: React.FC<{
  open: boolean;
  onClose: () => void;
  installedIds: string[];
  onInstalled: (createdId?: string) => void;
}> = ({ open, onClose, installedIds, onInstalled }) => {
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');

  // 配置阶段
  const [configuring, setConfiguring] = useState<MarketItemDetail | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState('');

  const fetchItems = useCallback(async (q?: string) => {
    setLoading(true);
    setError('');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const data = await marketApi.list({ type: 'connector', q: q || undefined });
      clearTimeout(timer);
      setItems(data?.items || []);
    } catch (e: any) {
      const msg = e.name === 'AbortError'
        ? '连接市场服务超时，请检查网络后重试'
        : (e.message || '无法连接市场服务');
      setError(msg);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchItems();
      setConfiguring(null);
      setInstallSuccess('');
    }
  }, [open, fetchItems]);

  const handleSearch = () => fetchItems(searchQuery);

  const handleInstall = async (item: MarketItem) => {
    // 已安装的跳过
    if (installedIds.includes(item.name)) return;

    setError('');
    try {
      const detail: MarketItemDetail = await marketApi.detail(item.id);
      const schema = detail.userConfigSchema;

      // 如果没有配置字段也没有变体，直接安装
      if (!schema || (!schema.fields?.length && !schema.variants?.length)) {
        await doInstall(detail, {});
      } else {
        // 需要用户配置
        setConfiguring(detail);
        setSelectedVariant(schema.variants?.[0]?.id || null);
        setConfigValues({});
      }
    } catch (e: any) {
      setError(e.message || '获取详情失败');
    }
  };

  const doInstall = async (
    detail: MarketItemDetail,
    userConfig: Record<string, string>,
    variantId?: string | null
  ) => {
    setInstalling(true);
    setError('');
    try {
      const variant = variantId
        ? detail.userConfigSchema?.variants?.find(v => v.id === variantId)
        : null;
      const ic = variant?.installConfig || detail.installConfig;

      // 构建 MCP 连接配置
      const config: Record<string, unknown> = {
        name: variant ? `${detail.name} (${variant.label})` : detail.name,
        description: detail.description,
        connection_type: 'stdio',
        command: ic.command,
        args: ic.args,
        env: { ...(ic.env || {}), ...userConfig },
      };

      // 创建连接
      const created = await mcpApi.create(config);
      // 记录安装
      marketApi.recordInstall(detail.id).catch(() => {});

      setInstallSuccess(`${config.name} 安装成功，正在测试连接…`);
      setConfiguring(null);
      onInstalled(created?.id);

      // 3秒后清除成功提示
      setTimeout(() => setInstallSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message || '安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const handleConfigSubmit = () => {
    if (!configuring) return;
    const variant = selectedVariant
      ? configuring.userConfigSchema?.variants?.find(v => v.id === selectedVariant)
      : null;
    const fields = variant?.fields || configuring.userConfigSchema?.fields || [];

    // 验证必填字段
    for (const f of fields) {
      if (f.required && !configValues[f.key]?.trim()) {
        setError(`请填写 ${f.label}`);
        return;
      }
    }

    doInstall(configuring, configValues, selectedVariant);
  };

  // 获取当前活动的配置字段
  const activeFields: MarketConfigField[] = configuring
    ? (selectedVariant
        ? configuring.userConfigSchema?.variants?.find(v => v.id === selectedVariant)?.fields
        : configuring.userConfigSchema?.fields) || []
    : [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/40" onClick={onClose} />
      <div className="relative bg-surface-container-high rounded-xl shadow-elevation-3 w-[560px] max-h-[80vh] flex flex-col animate-dialog-in">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-outline-variant shrink-0">
          <div className="flex items-center gap-2">
            {configuring && (
              <button type="button" onClick={() => { setConfiguring(null); setError(''); }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
              </button>
            )}
            <h3 className="text-lg font-medium text-on-surface">
              {configuring ? `配置 ${configuring.name}` : '从市场安装'}
            </h3>
          </div>
          <button type="button" onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {configuring ? (
            /* 配置表单阶段 */
            <div className="space-y-4">
              <p className="text-sm text-on-surface-variant">{configuring.description}</p>

              {/* 变体选择 */}
              {configuring.userConfigSchema?.variants && configuring.userConfigSchema.variants.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-on-surface-variant">选择来源</label>
                  {configuring.userConfigSchema.variants.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { setSelectedVariant(v.id); setConfigValues({}); }}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                        selectedVariant === v.id
                          ? 'border-primary bg-primary/[0.06]'
                          : 'border-outline-variant hover:bg-on-surface/[0.04]'
                      }`}
                    >
                      <div className="text-sm font-medium text-on-surface">{v.label}</div>
                      {v.description && <div className="text-xs text-on-surface-variant mt-0.5">{v.description}</div>}
                    </button>
                  ))}
                </div>
              )}

              {/* 配置字段 */}
              {activeFields.length > 0 && (
                <div className="space-y-3">
                  {activeFields.map(f => (
                    <div key={f.key}>
                      {f.type === 'select' && f.options ? (
                        <Select
                          label={`${f.label}${f.required ? ' *' : ''}`}
                          value={configValues[f.key] || ''}
                          onChange={v => setConfigValues(prev => ({ ...prev, [f.key]: v }))}
                          options={f.options}
                        />
                      ) : (
                        <TextField
                          label={`${f.label}${f.required ? ' *' : ''}`}
                          type={f.type === 'secret' ? 'password' : 'text'}
                          value={configValues[f.key] || ''}
                          onChange={v => setConfigValues(prev => ({ ...prev, [f.key]: v }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="text-sm text-error">{error}</p>}

              <div className="flex justify-end pt-2">
                <Button variant="filled" onClick={handleConfigSubmit} disabled={installing}>
                  {installing ? '安装中...' : '确认安装'}
                </Button>
              </div>
            </div>
          ) : (
            /* 列表阶段 */
            <>
              {/* 搜索栏 */}
              <div className="flex gap-2 mb-4">
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索连接器..."
                  className="flex-1 h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none hover:border-outline focus:border-primary focus:border-2 transition-colors"
                />
                <Button variant="outlined" onClick={handleSearch}>搜索</Button>
              </div>

              {installSuccess && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm border border-green-200">
                  {installSuccess}
                </div>
              )}

              {error && (
                <div className="mb-3 px-4 py-3 rounded-lg bg-error-container text-on-error-container text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                    <span>{error}</span>
                  </div>
                  <button type="button" onClick={() => fetchItems(searchQuery)} className="text-xs font-medium px-3 py-1 rounded-full bg-on-error-container/10 hover:bg-on-error-container/20 transition-colors">
                    重试
                  </button>
                </div>
              )}

              {loading ? (
                <div className="py-12 flex flex-col items-center gap-2 text-on-surface-variant text-sm">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  <span>正在连接市场服务...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="py-12 text-center text-on-surface-variant text-sm">
                  {searchQuery ? '未找到匹配的连接器' : '市场暂无可用连接器'}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* 未安装的在前 */}
                  {items.filter(item => !installedIds.includes(item.name)).map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-outline-variant hover:bg-on-surface/[0.02] transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0 text-lg">
                        {item.icon ? (
                          <img src={item.icon} alt="" className="w-6 h-6" />
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-on-surface-variant">
                            <path d="M14 12l-2 2-2-2 2-2 2 2zm-2-6l2.12 2.12 2.5-2.5L12 1 7.38 5.62l2.5 2.5L12 6zm-6 6l2.12-2.12-2.5-2.5L1 12l4.62 4.62 2.5-2.5L6 12zm12 0l-2.12 2.12 2.5 2.5L23 12l-4.62-4.62-2.5 2.5L18 12zm-6 6l-2.12-2.12-2.5 2.5L12 23l4.62-4.62-2.5-2.5L12 18z"/>
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-on-surface">{item.name}</span>
                          <span className="text-xs text-on-surface-variant">v{item.version}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant truncate">{item.description}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-on-surface-variant">{item.author}</span>
                          {item.installCount > 0 && (
                            <span className="text-xs text-on-surface-variant">{item.installCount} 次安装</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleInstall(item)}
                        className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors shrink-0 bg-primary text-on-primary hover:shadow-elevation-1"
                      >
                        安装
                      </button>
                    </div>
                  ))}

                  {/* 已安装分隔区 */}
                  {items.some(item => installedIds.includes(item.name)) && (
                    <>
                      {items.some(item => !installedIds.includes(item.name)) && (
                        <div className="border-t border-outline-variant my-3" />
                      )}
                      <div className="text-xs text-on-surface-variant font-medium px-1 mb-1">已安装</div>
                      {items.filter(item => installedIds.includes(item.name)).map(item => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-outline-variant/50 bg-on-surface/[0.02] opacity-70"
                        >
                          <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0 text-lg">
                            {item.icon ? (
                              <img src={item.icon} alt="" className="w-6 h-6" />
                            ) : (
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-on-surface-variant">
                                <path d="M14 12l-2 2-2-2 2-2 2 2zm-2-6l2.12 2.12 2.5-2.5L12 1 7.38 5.62l2.5 2.5L12 6zm-6 6l2.12-2.12-2.5-2.5L1 12l4.62 4.62 2.5-2.5L6 12zm12 0l-2.12 2.12 2.5 2.5L23 12l-4.62-4.62-2.5 2.5L18 12zm-6 6l-2.12-2.12-2.5 2.5L12 23l4.62-4.62-2.5-2.5L12 18z"/>
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-on-surface">{item.name}</span>
                              <span className="text-xs text-on-surface-variant">v{item.version}</span>
                            </div>
                            <p className="text-xs text-on-surface-variant truncate">{item.description}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-xs text-on-surface-variant">{item.author}</span>
                            </div>
                          </div>
                          <span className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-on-surface-variant bg-surface-container shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-primary"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                            已安装
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// MCP 连接池 Tab (参照 WorkX ConnectorsTab 设计)
// ==============================

const McpTab: React.FC = () => {
  const [connections, setConnections] = useState<McpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<McpItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [editingItem, setEditingItem] = useState<McpItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpItem | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const snackbarTimer = useRef<ReturnType<typeof setTimeout>>();
  const showSnackbar = (msg: string) => {
    clearTimeout(snackbarTimer.current);
    setSnackbar({ open: true, message: msg });
    snackbarTimer.current = setTimeout(() => setSnackbar({ open: false, message: '' }), 3000);
  };

  // 表单状态
  const [formMode, setFormMode] = useState<'stdio' | 'sse'>('stdio');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  // Stdio 字段
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formEnvRows, setFormEnvRows] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  // HTTP/SSE 字段
  const [formUrl, setFormUrl] = useState('');
  const [formHeaderRows, setFormHeaderRows] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [formAuthType, setFormAuthType] = useState('none');
  const [formApiKey, setFormApiKey] = useState('');

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mcpApi.list();
      setConnections(data || []);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  // 当 connections 更新后，同步 selected；无选中时默认选第一个
  useEffect(() => {
    if (selected) {
      const updated = connections.find(c => c.id === selected.id);
      if (updated) setSelected(updated);
      else setSelected(connections[0] || null);
    } else if (connections.length > 0) {
      setSelected(connections[0]);
    }
  }, [connections]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setFormMode('stdio');
    setFormName(''); setFormDescription('');
    setFormCommand(''); setFormArgs('');
    setFormEnvRows([{ key: '', value: '' }]);
    setFormUrl('');
    setFormHeaderRows([{ key: '', value: '' }]);
    setFormAuthType('none'); setFormApiKey('');
    setEditingItem(null);
  };

  const openCreate = () => { resetForm(); setShowModal(true); };

  const openEdit = (item: McpItem) => {
    setEditingItem(item);
    setFormMode(item.connection_type);
    setFormName(item.name);
    setFormDescription(item.description || '');
    // Stdio fields
    setFormCommand(item.command || '');
    setFormArgs(item.args?.join('\n') || '');
    const envRows = item.env
      ? Object.entries(item.env).map(([key, value]) => ({ key, value }))
      : [];
    envRows.push({ key: '', value: '' });
    setFormEnvRows(envRows);
    // HTTP fields
    setFormUrl(item.server_url || '');
    const headerRows = item.headers
      ? Object.entries(item.headers).map(([key, value]) => ({ key, value }))
      : [];
    headerRows.push({ key: '', value: '' });
    setFormHeaderRows(headerRows);
    setFormAuthType(item.auth_type || 'none');
    setFormApiKey('');
    setShowModal(true);
  };

  /** 动态 key-value 行管理器 */
  const updateKvRow = (
    rows: { key: string; value: string }[],
    setRows: React.Dispatch<React.SetStateAction<{ key: string; value: string }[]>>,
    idx: number,
    field: 'key' | 'value',
    val: string
  ) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
    // 如果最后一行有内容，自动追加空行
    const last = next[next.length - 1];
    if (last && (last.key || last.value)) next.push({ key: '', value: '' });
    setRows(next);
  };

  const removeKvRow = (
    rows: { key: string; value: string }[],
    setRows: React.Dispatch<React.SetStateAction<{ key: string; value: string }[]>>,
    idx: number
  ) => {
    const next = rows.filter((_, i) => i !== idx);
    if (next.length === 0) next.push({ key: '', value: '' });
    setRows(next);
  };

  /** 将 kv rows 转为 Record (过滤空行) */
  const kvToRecord = (rows: { key: string; value: string }[]): Record<string, string> | undefined => {
    const obj: Record<string, string> = {};
    for (const r of rows) {
      if (r.key.trim()) obj[r.key.trim()] = r.value;
    }
    return Object.keys(obj).length > 0 ? obj : undefined;
  };

  const handleSave = async () => {
    if (!formName.trim()) { showSnackbar('请填写连接名称'); return; }
    if (formMode === 'stdio' && !formCommand.trim()) { showSnackbar('请填写命令'); return; }
    if (formMode === 'sse' && !formUrl.trim()) { showSnackbar('请填写 URL'); return; }

    const payload: Record<string, unknown> = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      connection_type: formMode,
    };

    if (formMode === 'stdio') {
      payload.command = formCommand.trim();
      const args = formArgs.split('\n').map(s => s.trim()).filter(Boolean);
      payload.args = args.length > 0 ? args : undefined;
      payload.env = kvToRecord(formEnvRows);
      // 清空 HTTP 字段
      payload.server_url = null;
      payload.headers = null;
    } else {
      payload.server_url = formUrl.trim();
      payload.headers = kvToRecord(formHeaderRows);
      payload.auth_type = formAuthType;
      if (formAuthType !== 'none' && formApiKey) {
        payload.auth_config = { api_key: formApiKey };
      }
      // 清空 Stdio 字段
      payload.command = null;
      payload.args = null;
      payload.env = null;
    }

    try {
      let created: any = null;
      if (editingItem) {
        await mcpApi.update(editingItem.id, payload);
        showSnackbar('连接更新成功');
      } else {
        created = await mcpApi.create(payload);
      }
      setShowModal(false); resetForm();
      await fetchConnections();
      // 创建后自动测试连接
      if (created?.id) {
        setSelected(created);
        autoTest(created.id);
      }
    } catch (err: any) {
      showSnackbar(err.message || '操作失败');
    }
  };

  /** 自动测试连接并更新状态 */
  const autoTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await mcpApi.test(id);
      const latency = result?.latency_ms ? ` (${result.latency_ms}ms)` : '';
      showSnackbar(result?.connected ? `连接成功${latency}` : '连接测试失败');
    } catch { showSnackbar('连接测试失败'); }
    setTestingId(null);
    fetchConnections();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await mcpApi.delete(deleteTarget.id);
      showSnackbar('MCP 连接已删除');
      if (selected?.id === deleteTarget.id) setSelected(null);
      fetchConnections();
    } catch (err: any) {
      showSnackbar(err.message || '删除失败');
    }
    setDeleteTarget(null);
  };

  const handleTest = async (item: McpItem) => {
    setTestingId(item.id);
    try {
      const result = await mcpApi.test(item.id);
      const latency = result?.latency_ms ? `${result.latency_ms}ms` : '';
      showSnackbar(`连接测试：${result?.connected ? '成功' : '失败'} ${latency}`);
      fetchConnections();
    } catch (err: any) {
      showSnackbar(err.message || '连接测试失败');
    }
    setTestingId(null);
  };

  const connectedCount = connections.filter(c => c.health_status === 'healthy').length;

  // 分组: 健康 / 其他
  const healthyConns = connections.filter(c => c.health_status === 'healthy');
  const otherConns = connections.filter(c => c.health_status !== 'healthy');

  /** 状态指示点 */
  const StatusDot: React.FC<{ status: string }> = ({ status }) => (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
      status === 'healthy' ? 'bg-green-500' : status === 'unhealthy' ? 'bg-red-500' : 'bg-gray-400'
    }`} />
  );

  return (
    <div className="space-y-4">
      {/* 统计 + 操作栏 */}
      <div className="flex items-center justify-between">
        <p className="body-medium text-on-surface-variant">
          共 <span className="text-on-surface font-medium">{connections.length}</span> 个连接，
          <span className="text-on-surface font-medium">{connectedCount}</span> 个已连接
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outlined" onClick={() => setShowMarket(true)}>从市场安装</Button>
          <Button variant="filled" onClick={openCreate} icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          }>添加连接器</Button>
        </div>
      </div>

      {/* 两栏布局：左列表 + 右详情 */}
      {loading ? (
        <div className="bg-surface-container rounded-lg p-12 text-center">
          <p className="body-medium text-on-surface-variant">加载中...</p>
        </div>
      ) : connections.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 text-center">
          <p className="body-medium text-on-surface-variant">暂无 MCP 连接，点击「添加连接器」添加</p>
        </div>
      ) : (
        <div className="flex gap-0 rounded-xl border border-outline-variant overflow-hidden bg-white" style={{ minHeight: 420 }}>
          {/* 左侧列表 */}
          <div className="w-64 min-w-[240px] border-r border-outline-variant bg-surface-container-low overflow-y-auto">
            {healthyConns.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-xs text-on-surface-variant font-medium">已连接</div>
                {healthyConns.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      selected?.id === c.id ? 'bg-primary/[0.08]' : 'hover:bg-on-surface/[0.04]'
                    }`}
                  >
                    <StatusDot status={c.health_status} />
                    <span className="text-sm text-on-surface truncate">{c.name}</span>
                  </button>
                ))}
              </>
            )}
            {otherConns.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-xs text-on-surface-variant font-medium">
                  {healthyConns.length > 0 ? '未连接' : '全部连接'}
                </div>
                {otherConns.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      selected?.id === c.id ? 'bg-primary/[0.08]' : 'hover:bg-on-surface/[0.04]'
                    }`}
                  >
                    <StatusDot status={c.health_status} />
                    <span className="text-sm text-on-surface truncate">{c.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 overflow-y-auto p-6">
            {selected ? (
              <div className="space-y-5">
                {/* 标题 + 操作 */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-on-surface">{selected.name}</h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <StatusDot status={selected.health_status} />
                      <span className="text-xs text-on-surface-variant">
                        {selected.health_status === 'healthy' ? '已连接' : selected.health_status === 'unhealthy' ? '连接异常' : '未检测'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openEdit(selected)}
                      className="text-sm text-primary hover:underline font-medium">编辑</button>
                    <button
                      type="button"
                      onClick={() => handleTest(selected)}
                      disabled={testingId === selected.id}
                      className="text-sm text-on-surface-variant hover:text-on-surface font-medium disabled:opacity-40"
                    >
                      {testingId === selected.id ? '测试中...' : '测试'}
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(selected)}
                      className="text-sm text-error hover:underline font-medium">删除</button>
                  </div>
                </div>

                {selected.description && (
                  <p className="text-sm text-on-surface-variant">{selected.description}</p>
                )}

                {/* 连接信息 */}
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-on-surface-variant mb-0.5">连接类型</div>
                    <div className="text-sm text-on-surface">{selected.connection_type === 'stdio' ? 'Stdio' : 'HTTP / SSE'}</div>
                  </div>

                  {selected.connection_type === 'stdio' ? (
                    <>
                      {selected.command && (
                        <div>
                          <div className="text-xs text-on-surface-variant mb-0.5">命令</div>
                          <div className="bg-surface-container rounded-lg px-3 py-2 text-sm font-mono text-on-surface">{selected.command}</div>
                        </div>
                      )}
                      {selected.args && selected.args.length > 0 && (
                        <div>
                          <div className="text-xs text-on-surface-variant mb-0.5">参数</div>
                          <div className="bg-surface-container rounded-lg px-3 py-2 text-sm font-mono text-on-surface break-all">
                            {selected.args.join(' ')}
                          </div>
                        </div>
                      )}
                      {selected.env && Object.keys(selected.env).length > 0 && (
                        <div>
                          <div className="text-xs text-on-surface-variant mb-0.5">环境变量</div>
                          <div className="bg-surface-container rounded-lg px-3 py-2 space-y-1">
                            {Object.entries(selected.env).map(([k, v]) => {
                              const val = String(v);
                              const masked = val.length > 8
                                ? `${val.slice(0, 4)}${'···'}${val.slice(-4)}`
                                : '••••••••';
                              return (
                                <div key={k} className="text-sm font-mono">
                                  <span className="text-primary">{k}</span>
                                  <span className="text-on-surface-variant"> = </span>
                                  <span className="text-on-surface">{masked}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {selected.server_url && (
                        <div>
                          <div className="text-xs text-on-surface-variant mb-0.5">URL</div>
                          <div className="bg-surface-container rounded-lg px-3 py-2 text-sm font-mono text-on-surface break-all">{selected.server_url}</div>
                        </div>
                      )}
                      {selected.auth_type && selected.auth_type !== 'none' && (
                        <div>
                          <div className="text-xs text-on-surface-variant mb-0.5">认证方式</div>
                          <div className="text-sm text-on-surface">{selected.auth_type === 'api_key' ? 'API Key' : selected.auth_type}</div>
                        </div>
                      )}
                      {selected.headers && Object.keys(selected.headers).length > 0 && (
                        <div>
                          <div className="text-xs text-on-surface-variant mb-0.5">请求头</div>
                          <div className="bg-surface-container rounded-lg px-3 py-2 space-y-1">
                            {Object.entries(selected.headers).map(([k, v]) => {
                              const val = String(v);
                              const masked = val.length > 8
                                ? `${val.slice(0, 4)}${'···'}${val.slice(-4)}`
                                : '••••••••';
                              return (
                                <div key={k} className="text-sm font-mono">
                                  <span className="text-primary">{k}</span>
                                  <span className="text-on-surface-variant">: </span>
                                  <span className="text-on-surface">{masked}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {selected.last_health_check && (
                    <div>
                      <div className="text-xs text-on-surface-variant mb-0.5">上次检查</div>
                      <div className="text-sm text-on-surface">{new Date(selected.last_health_check).toLocaleString('zh-CN')}</div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-on-surface-variant text-sm">
                ← 选择一个连接器查看详情
              </div>
            )}
          </div>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal open={showModal} title={editingItem ? '编辑连接器' : '添加连接器'} onClose={() => { setShowModal(false); resetForm(); }}>
        <div className="space-y-4 mt-2">
          {/* 模式切换 Tab */}
          <div className="flex gap-0 rounded-lg border border-outline-variant overflow-hidden">
            {(['stdio', 'sse'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setFormMode(mode)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  formMode === mode
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.06]'
                }`}
              >
                {mode === 'stdio' ? 'Stdio' : 'HTTP / SSE'}
              </button>
            ))}
          </div>

          <TextField label="名称 *" value={formName} onChange={setFormName} helperText="如：文件系统、GitHub" />

          {formMode === 'stdio' ? (
            <>
              <TextField label="命令 *" value={formCommand} onChange={setFormCommand} helperText="如：npx、uvx、node" />
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">参数（每行一个）</label>
                <textarea
                  value={formArgs}
                  onChange={e => setFormArgs(e.target.value)}
                  rows={3}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                  className="w-full px-3 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none font-mono resize-none hover:border-outline focus:border-primary focus:border-2 transition-colors"
                />
              </div>
              {/* 环境变量 key-value */}
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">环境变量</label>
                <div className="space-y-1.5">
                  {formEnvRows.map((row, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        value={row.key}
                        onChange={e => updateKvRow(formEnvRows, setFormEnvRows, idx, 'key', e.target.value)}
                        placeholder="变量名"
                        className="flex-1 h-9 px-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none font-mono hover:border-outline focus:border-primary focus:border-2 transition-colors"
                      />
                      <input
                        value={row.value}
                        onChange={e => updateKvRow(formEnvRows, setFormEnvRows, idx, 'value', e.target.value)}
                        placeholder="值"
                        className="flex-1 h-9 px-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none font-mono hover:border-outline focus:border-primary focus:border-2 transition-colors"
                      />
                      {(row.key || row.value) && (
                        <button type="button" onClick={() => removeKvRow(formEnvRows, setFormEnvRows, idx)}
                          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-error/[0.08] text-on-surface-variant hover:text-error shrink-0">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <TextField label="URL *" value={formUrl} onChange={setFormUrl} helperText="MCP 服务地址" />
              <Select label="认证类型" value={formAuthType} onChange={setFormAuthType} options={AUTH_TYPE_OPTIONS} />
              {formAuthType !== 'none' && (
                <TextField label="API Key / Token" type="password" value={formApiKey} onChange={setFormApiKey} />
              )}
              {/* 自定义请求头 */}
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">自定义请求头</label>
                <div className="space-y-1.5">
                  {formHeaderRows.map((row, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        value={row.key}
                        onChange={e => updateKvRow(formHeaderRows, setFormHeaderRows, idx, 'key', e.target.value)}
                        placeholder="Header 名称"
                        className="flex-1 h-9 px-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none font-mono hover:border-outline focus:border-primary focus:border-2 transition-colors"
                      />
                      <input
                        value={row.value}
                        onChange={e => updateKvRow(formHeaderRows, setFormHeaderRows, idx, 'value', e.target.value)}
                        placeholder="值"
                        className="flex-1 h-9 px-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface outline-none font-mono hover:border-outline focus:border-primary focus:border-2 transition-colors"
                      />
                      {(row.key || row.value) && (
                        <button type="button" onClick={() => removeKvRow(formHeaderRows, setFormHeaderRows, idx)}
                          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-error/[0.08] text-on-surface-variant hover:text-error shrink-0">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <TextField label="描述（可选）" value={formDescription} onChange={setFormDescription} />

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="text" onClick={() => { setShowModal(false); resetForm(); }}>取消</Button>
            <Button variant="filled" onClick={handleSave}>{editingItem ? '保存' : '添加'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        message={`确定要删除连接器「${deleteTarget?.name}」吗？此操作不可撤销。`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 市场浏览弹窗 */}
      <MarketBrowseModal
        open={showMarket}
        onClose={() => setShowMarket(false)}
        installedIds={connections.map(c => c.name)}
        onInstalled={(createdId?: string) => {
          fetchConnections();
          if (createdId) autoTest(createdId);
        }}
      />

      <Snackbar message={snackbar.message} open={snackbar.open} onClose={() => setSnackbar({ open: false, message: '' })} />
    </div>
  );
};

// ==============================
// 主组件
// ==============================

const ResourcePool: React.FC = () => {
  const [activeTab, setActiveTab] = useState('models');

  return (
    <div className="h-full flex flex-col font-roboto">
      {/* 页面标题 */}
      <div className="mb-4">
        <h2 className="title-large text-on-surface">资源池</h2>
        <p className="body-medium text-on-surface-variant mt-1">
          管理可供数字员工使用的模型、技能和外部服务
        </p>
      </div>

      {/* Tab 切换 */}
      <Tabs tabs={RESOURCE_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto pt-6">
        {activeTab === 'models' && <ModelTab />}
        {activeTab === 'mcp' && <McpTab />}
        {activeTab === 'skills' && <SkillTab />}
      </div>
    </div>
  );
};

export default ResourcePool;
