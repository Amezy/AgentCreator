/**
 * @module Settings
 * @description AgentCreator 系统设置页面 — M3 设计风格，与其他页面保持一致。
 */
import React, { useState, useEffect, useCallback } from 'react';
import Card from '../../components/m3/Card';
import Button from '../../components/m3/Button';
import Snackbar from '../../components/m3/Snackbar';
import { monitorApi } from '../../services/agentCreatorApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemInfo {
  hostname: string;
  cpu_count: number;
  memory_total_gb: number;
  disk_total_gb: number;
}

interface SectionDef {
  id: string;
  label: string;
  icon: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

const SECTIONS: SectionDef[] = [
  {
    id: 'general',
    label: '通用设置',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    ),
  },
  {
    id: 'model',
    label: '模型配置',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.49 12.65 0L21 3v7.12z"/>
      </svg>
    ),
  },
  {
    id: 'security',
    label: '安全设置',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
      </svg>
    ),
  },
  {
    id: 'market',
    label: '市场服务',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.36 9l.6 3H5.04l.6-3h12.72M20 4H4v2h16V4zm0 3H4l-1 5v2h1v6h10v-6h4v6h2v-6h1v-2l-1-5zM6 18v-4h6v4H6z"/>
      </svg>
    ),
  },
  {
    id: 'about',
    label: '关于系统',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Setting row: label + control */
const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between py-3 border-b border-outline-variant/50 last:border-b-0">
    <div>
      <div className="text-sm text-on-surface">{label}</div>
      {hint && <div className="text-xs text-on-surface-variant mt-0.5">{hint}</div>}
    </div>
    <div>{children}</div>
  </div>
);

/** Simple toggle */
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
      checked ? 'bg-primary' : 'bg-outline/30'
    }`}
  >
    <div
      className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
        checked ? 'left-[26px]' : 'left-1'
      }`}
    />
  </button>
);

/** Inline text input */
const InlineInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, className = 'w-56', placeholder }) => (
  <input
    type="text"
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className={`bg-surface-container rounded-lg border border-outline-variant px-3 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary transition-colors ${className}`}
  />
);

/** Read-only value chip */
const ValueChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="px-3 py-1 rounded-lg bg-surface-container text-sm font-mono text-on-surface-variant">
    {children}
  </span>
);

/** Status dot with label */
const StatusLabel: React.FC<{ status: 'online' | 'offline' | 'checking'; label: string }> = ({ status, label }) => {
  const dotColor = status === 'online' ? 'bg-[#4caf50]' : status === 'offline' ? 'bg-error' : 'bg-[#ff9800]';
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
      <span className="text-sm text-on-surface-variant">{label}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const Settings: React.FC = () => {
  const [activeSection, setActiveSection] = useState('general');
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const toast = useCallback((msg: string) => setSnackbar({ open: true, message: msg }), []);

  // System info
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    monitorApi.getSystemStats().then((d: any) => {
      if (d) setSysInfo({ hostname: d.hostname, cpu_count: d.cpu_count, memory_total_gb: d.memory_total_gb, disk_total_gb: d.disk_total_gb });
    }).catch(() => {});
  }, []);

  // Settings state
  const [debugMode, setDebugMode] = useState(false);
  const [maxAgents, setMaxAgents] = useState('5');
  const [maxUploadMB, setMaxUploadMB] = useState('50');
  const [jwtExpire, setJwtExpire] = useState('1440');
  const [marketUrl, setMarketUrl] = useState('http://121.199.63.30:9091/api/v1');
  const [marketStatus, setMarketStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [autoTestOnCreate, setAutoTestOnCreate] = useState(true);
  const [enableTLS, setEnableTLS] = useState(false);

  // Check market
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/v1/agent/market/items?pageSize=1', { signal: ctrl.signal })
      .then(r => setMarketStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setMarketStatus('offline'));
    return () => ctrl.abort();
  }, []);

  const handleSave = () => toast('设置已保存（当前为演示模式）');

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  const renderGeneral = () => (
    <div className="space-y-6">
      <Card variant="outlined">
        <h3 className="title-small text-on-surface mb-4">运行参数</h3>
        <Row label="调试模式" hint="开启后输出详细日志到控制台">
          <Toggle checked={debugMode} onChange={setDebugMode} />
        </Row>
        <Row label="最大并发 Agent" hint="同时运行的数字员工上限">
          <InlineInput value={maxAgents} onChange={setMaxAgents} className="w-20 text-center" />
        </Row>
        <Row label="最大上传文件 (MB)" hint="单个文件上传大小限制">
          <InlineInput value={maxUploadMB} onChange={setMaxUploadMB} className="w-20 text-center" />
        </Row>
      </Card>
      <Card variant="outlined">
        <h3 className="title-small text-on-surface mb-4">数据存储</h3>
        <Row label="数据库路径"><ValueChip>data/agent.db</ValueChip></Row>
        <Row label="向量库路径"><ValueChip>data/chroma</ValueChip></Row>
        <Row label="产物目录"><ValueChip>data/artifacts</ValueChip></Row>
      </Card>
    </div>
  );

  const renderModel = () => (
    <Card variant="outlined">
      <h3 className="title-small text-on-surface mb-4">默认模型配置</h3>
      <p className="body-small text-on-surface-variant mb-4">新数字员工创建时使用的默认模型参数</p>
      <Row label="推理模型"><ValueChip>claude-sonnet-4-6</ValueChip></Row>
      <Row label="回退模型"><ValueChip>claude-haiku-4-5</ValueChip></Row>
      <Row label="温度 (Temperature)" hint="0 = 精确，1 = 创意">
        <InlineInput value="0.7" onChange={() => {}} className="w-20 text-center" />
      </Row>
      <Row label="最大 Token">
        <InlineInput value="4096" onChange={() => {}} className="w-20 text-center" />
      </Row>
    </Card>
  );

  const renderSecurity = () => (
    <div className="space-y-6">
      <Card variant="outlined">
        <h3 className="title-small text-on-surface mb-4">认证配置</h3>
        <Row label="JWT 过期时间 (分钟)">
          <InlineInput value={jwtExpire} onChange={setJwtExpire} className="w-24 text-center" />
        </Row>
        <Row label="JWT 算法"><ValueChip>HS256</ValueChip></Row>
        <Row label="强制 TLS" hint="要求所有 API 请求使用 HTTPS">
          <Toggle checked={enableTLS} onChange={setEnableTLS} />
        </Row>
      </Card>
      <Card variant="outlined">
        <h3 className="title-small text-on-surface mb-4">API 密钥</h3>
        <p className="body-small text-on-surface-variant">
          外部服务 API 密钥通过环境变量或 MCP 连接器的环境变量字段管理，不在此处配置。
        </p>
      </Card>
    </div>
  );

  const renderMarket = () => (
    <Card variant="outlined">
      <h3 className="title-small text-on-surface mb-4">市场服务连接</h3>
      <p className="body-small text-on-surface-variant mb-4">连接 WorkX-Market 连接器市场</p>
      <Row label="服务状态">
        <StatusLabel
          status={marketStatus}
          label={marketStatus === 'online' ? '已连接' : marketStatus === 'offline' ? '未连接' : '检测中...'}
        />
      </Row>
      <Row label="服务地址">
        <InlineInput value={marketUrl} onChange={setMarketUrl} className="w-80" />
      </Row>
      <Row label="创建后自动测试" hint="安装连接器后自动验证连接">
        <Toggle checked={autoTestOnCreate} onChange={setAutoTestOnCreate} />
      </Row>
    </Card>
  );

  const renderAbout = () => (
    <div className="space-y-6">
      <Card variant="outlined">
        <h3 className="title-small text-on-surface mb-4">系统信息</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            { label: 'CPU 核心', value: sysInfo ? `${sysInfo.cpu_count}` : '--' },
            { label: '内存', value: sysInfo ? `${sysInfo.memory_total_gb} GB` : '--' },
            { label: '磁盘', value: sysInfo ? `${sysInfo.disk_total_gb} GB` : '--' },
          ].map(s => (
            <div key={s.label} className="bg-surface-container rounded-xl p-4 text-center">
              <p className="headline-small text-on-surface">{s.value}</p>
              <p className="label-small text-on-surface-variant mt-1">{s.label}</p>
            </div>
          ))}
        </div>
        {sysInfo?.hostname && (
          <Row label="主机名"><ValueChip>{sysInfo.hostname}</ValueChip></Row>
        )}
      </Card>
      <Card variant="outlined">
        <h3 className="title-small text-on-surface mb-4">关于 AgentCreator</h3>
        <Row label="版本"><ValueChip>1.0.0</ValueChip></Row>
        <Row label="后端框架"><ValueChip>FastAPI + aiosqlite</ValueChip></Row>
        <Row label="前端框架"><ValueChip>React + Tailwind CSS</ValueChip></Row>
        <Row label="AI 引擎"><ValueChip>Claude Opus 4.6 / Sonnet 4.6</ValueChip></Row>
      </Card>
    </div>
  );

  const contentMap: Record<string, () => React.ReactNode> = {
    general: renderGeneral,
    model: renderModel,
    security: renderSecurity,
    market: renderMarket,
    about: renderAbout,
  };

  return (
    <div className="h-full flex flex-col font-roboto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="title-large text-on-surface">系统设置</h2>
          <p className="body-medium text-on-surface-variant mt-1">
            配置 AgentCreator 运行参数、安全策略与外部服务
          </p>
        </div>
        <Button variant="filled" onClick={handleSave}>保存设置</Button>
      </div>

      {/* Body: left tabs + right content */}
      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Section tabs */}
        <div className="w-44 shrink-0 space-y-1">
          {SECTIONS.map(s => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  active
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-on-surface/[0.08]'
                }`}
              >
                <span className={`shrink-0 ${active ? 'text-on-secondary-container' : 'text-on-surface-variant'}`}>
                  {s.icon}
                </span>
                <span className={`text-sm ${active ? 'font-bold' : 'font-medium'}`}>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-4">
          {contentMap[activeSection]?.()}
        </div>
      </div>

      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default Settings;
