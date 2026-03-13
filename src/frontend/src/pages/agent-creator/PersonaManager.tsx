/**
 * @module PersonaManager
 * @description 员工管理页面 - 展示数字员工列表和统计信息，支持过滤、创建和删除。
 * 以卡片网格形式展示每位数字员工的角色、等级、状态和技能信息。
 */
import React, { useState, useEffect, useCallback } from 'react';
import Button from '../../components/m3/Button';
import Snackbar from '../../components/m3/Snackbar';
import PersonaWizard from './components/PersonaWizard';
import { personaApi, positionApi } from '../../services/agentCreatorApi';

// ===== 常量 =====

const LEVEL_CONFIG: Record<string, { label: string; color: string }> = {
  junior: { label: '初级', color: 'bg-primary-container text-on-primary-container' },
  mid: { label: '中级', color: 'bg-secondary-container text-on-secondary-container' },
  senior: { label: '高级', color: 'bg-tertiary-container text-on-tertiary-container' },
  expert: { label: '专家', color: 'bg-error-container text-on-error-container' },
};

const STATUS_CONFIG: Record<string, { label: string; dot: string }> = {
  idle: { label: '空闲', dot: 'bg-on-surface-variant' },
  busy: { label: '忙碌', dot: 'bg-primary' },
  offline: { label: '离线', dot: 'bg-error' },
  error: { label: '异常', dot: 'bg-tertiary' },
};

const LEVEL_OPTIONS = [
  { label: '全部等级', value: '' },
  { label: '初级', value: 'junior' },
  { label: '中级', value: 'mid' },
  { label: '高级', value: 'senior' },
  { label: '专家', value: 'expert' },
];

const STATUS_OPTIONS = [
  { label: '全部状态', value: '' },
  { label: '空闲', value: 'idle' },
  { label: '忙碌', value: 'busy' },
  { label: '离线', value: 'offline' },
  { label: '异常', value: 'error' },
];

// ===== 通用 Select =====

const Select: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  options: { label: string; value: string }[]; className?: string;
}> = ({ label, value, onChange, options, className = '' }) => (
  <div className={`font-roboto ${className}`}>
    <label className="block body-small text-on-surface-variant mb-1 ml-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-transparent border border-outline rounded-xs text-on-surface body-large outline-none focus:border-primary focus:border-2 transition-colors"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ===== 确认删除弹窗 =====

const ConfirmDialog: React.FC<{
  open: boolean; message: string; onConfirm: () => void; onCancel: () => void;
}> = ({ open, message, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/50" onClick={onCancel} />
      <div className="relative bg-surface-container-high rounded-xl shadow-elevation-3 p-6 max-w-sm mx-4">
        <p className="body-large text-on-surface mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onCancel}>取消</Button>
          <Button variant="filled" onClick={onConfirm}>确认删除</Button>
        </div>
      </div>
    </div>
  );
};

// ===== 主组件 =====

const PersonaManager: React.FC = () => {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [personas, setPersonas] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // 过滤器
  const [filterPosition, setFilterPosition] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const fetchPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterPosition) params.position_id = filterPosition;
      if (filterLevel) params.level = filterLevel;
      if (filterStatus) params.status = filterStatus;
      const hasParams = Object.keys(params).length > 0;
      const data = await personaApi.list(hasParams ? params as any : undefined);
      setPersonas(data || []);
    } catch {
      setPersonas([]);
    } finally {
      setLoading(false);
    }
  }, [filterPosition, filterLevel, filterStatus]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await personaApi.getStats();
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  const fetchPositions = useCallback(async () => {
    try {
      const data = await positionApi.list();
      setPositions(data || []);
    } catch {
      setPositions([]);
    }
  }, []);

  useEffect(() => { fetchPersonas(); }, [fetchPersonas]);
  useEffect(() => { fetchStats(); fetchPositions(); }, [fetchStats, fetchPositions]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await personaApi.delete(deleteTarget.id);
      setSnackbar({ open: true, message: '员工已删除' });
      fetchPersonas();
      fetchStats();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '删除失败' });
    }
    setDeleteTarget(null);
  };

  const handleCreated = () => {
    fetchPersonas();
    fetchStats();
  };

  const getInitial = (name: string) => {
    return (name || '?').charAt(0).toUpperCase();
  };

  const positionOptions = [
    { label: '全部岗位', value: '' },
    ...positions.map((p: any) => ({ label: p.name, value: p.id })),
  ];

  const totalCount = stats?.total || personas.length;
  const idleCount = stats?.idle ?? personas.filter((p: any) => p.status === 'idle').length;
  const busyCount = stats?.busy ?? personas.filter((p: any) => p.status === 'busy').length;
  const offlineCount = stats?.offline ?? personas.filter((p: any) => p.status === 'offline').length;
  const errorCount = stats?.error ?? personas.filter((p: any) => p.status === 'error').length;

  return (
    <div className="h-full flex flex-col font-roboto">
      {/* 页面标题 + 创建按钮 */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="title-large text-on-surface">员工管理</h2>
          <p className="body-medium text-on-surface-variant mt-1">
            创建和管理你的数字员工，为每位员工配置角色、技能和模型
          </p>
        </div>
        <Button
          variant="filled"
          onClick={() => setWizardOpen(true)}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          }
        >
          创建员工
        </Button>
      </div>

      {/* 统计栏 */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-4 py-2">
          <span className="body-medium text-on-surface-variant">总计</span>
          <span className="title-medium text-on-surface">{totalCount}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-on-surface-variant" />
          <span className="body-small text-on-surface-variant">空闲 {idleCount}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="body-small text-on-surface-variant">忙碌 {busyCount}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-error" />
          <span className="body-small text-on-surface-variant">离线 {offlineCount}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-tertiary" />
          <span className="body-small text-on-surface-variant">异常 {errorCount}</span>
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="w-44">
          <Select label="岗位" value={filterPosition} onChange={setFilterPosition} options={positionOptions} />
        </div>
        <div className="w-36">
          <Select label="等级" value={filterLevel} onChange={setFilterLevel} options={LEVEL_OPTIONS} />
        </div>
        <div className="w-36">
          <Select label="状态" value={filterStatus} onChange={setFilterStatus} options={STATUS_OPTIONS} />
        </div>
      </div>

      {/* 员工列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="bg-surface-container rounded-lg p-12 text-center">
            <p className="body-medium text-on-surface-variant">加载中...</p>
          </div>
        ) : personas.length === 0 ? (
          /* 空状态 */
          <div className="bg-surface border border-outline-variant rounded-md p-6 text-center py-12">
            <div className="w-16 h-16 rounded-full bg-primary-container/30 flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-primary/60">
                <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/>
              </svg>
            </div>
            <p className="title-medium text-on-surface mb-1">暂无数字员工</p>
            <p className="body-medium text-on-surface-variant mb-4">
              点击"创建员工"开始组建你的数字团队
            </p>
            <Button variant="tonal" onClick={() => setWizardOpen(true)}>
              创建第一位员工
            </Button>
          </div>
        ) : (
          /* 卡片网格 */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {personas.map((persona: any) => {
              const levelCfg = LEVEL_CONFIG[persona.level] || { label: persona.level, color: 'bg-surface-container-highest text-on-surface-variant' };
              const statusCfg = STATUS_CONFIG[persona.status] || { label: persona.status || '未知', dot: 'bg-on-surface-variant' };
              const posName = persona.position_name || persona.positionName || positions.find((p: any) => p.id === (persona.position_id || persona.positionId))?.name || '';
              const skillCount = persona.skill_ids?.length || persona.skillIds?.length || persona.skills_count || 0;

              return (
                <div
                  key={persona.id}
                  className="bg-surface-container-low rounded-md p-4 border border-outline-variant hover:shadow-elevation-1 transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    {/* 头像 */}
                    <div className="shrink-0">
                      {persona.avatar ? (
                        <img
                          src={persona.avatar}
                          alt={persona.name}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary-container flex items-center justify-center">
                          <span className="title-medium text-on-primary-container">
                            {getInitial(persona.name)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="title-small text-on-surface truncate">{persona.name}</h3>
                        <span className={`inline-block px-2 py-0.5 rounded-full label-small shrink-0 ${levelCfg.color}`}>
                          {levelCfg.label}
                        </span>
                      </div>
                      {posName && (
                        <p className="body-small text-on-surface-variant mt-0.5 truncate">{posName}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        {/* 状态指示 */}
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
                          <span className="label-small text-on-surface-variant">{statusCfg.label}</span>
                        </div>
                        {/* 技能数 */}
                        {skillCount > 0 && (
                          <span className="label-small bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded-full">
                            {skillCount} 项技能
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        className="p-2 rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant"
                        title="编辑"
                        onClick={() => setSnackbar({ open: true, message: '编辑功能开发中' })}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-full hover:bg-error/[0.08] text-error"
                        title="删除"
                        onClick={() => setDeleteTarget(persona)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 创建向导弹窗 */}
      <PersonaWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={handleCreated}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        message={`确定要删除员工「${deleteTarget?.name}」吗？此操作不可撤销。`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default PersonaManager;
