/**
 * @module Dashboard
 * @description 监控仪表盘 - 展示系统资源、数字员工统计、模型使用和最近活动。
 * 自动每 30 秒刷新数据。
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import Card from '../../components/m3/Card';
import Button from '../../components/m3/Button';
import Snackbar from '../../components/m3/Snackbar';
import { monitorApi } from '../../services/agentCreatorApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemStats {
  cpu_percent: number;
  cpu_count: number;
  memory_percent: number;
  memory_total_gb: number;
  memory_used_gb: number;
  disk_percent: number;
  disk_total_gb: number;
  disk_used_gb: number;
  hostname: string;
  timestamp: string;
}

interface AgentStats {
  total_personas: number;
  active_personas: number;
  personas_by_status: Record<string, number>;
  total_teams: number;
  active_teams: number;
  total_conversations: number;
  active_conversations: number;
  messages_today: number;
  total_messages: number;
}

interface ModelUsageItem {
  model_name: string;
  message_count: number;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tier: string;
  quota_total: number;
  quota_used: number;
  is_active: boolean;
  health_status: string;
}

interface ModelUsage {
  models: ModelInfo[];
  usage_by_model: ModelUsageItem[];
  total_models: number;
  active_models: number;
}

interface ActivityItem {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string;
  content_preview: string;
  content_type: string;
  created_at: string;
  conversation_title: string;
  persona_name: string;
}

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, { status: string; message: string }>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Percentage ring color */
function percentColor(pct: number): string {
  if (pct >= 90) return 'text-error';
  if (pct >= 70) return 'text-tertiary';
  return 'text-primary';
}

/** Health status dot color */
function healthDotClass(status: string): string {
  if (status === 'healthy') return 'bg-[#4caf50]';
  if (status === 'degraded') return 'bg-[#ff9800]';
  return 'bg-error';
}

/** Format relative time in Chinese */
function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

// ---------------------------------------------------------------------------
// Stat Card (circular progress)
// ---------------------------------------------------------------------------

const CircularGauge: React.FC<{ percent: number; size?: number }> = ({
  percent,
  size = 56,
}) => {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className={percentColor(percent)}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        opacity={0.15}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-700"
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-on-surface text-[11px] font-medium"
      >
        {Math.round(percent)}%
      </text>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Bar chart (CSS-only)
// ---------------------------------------------------------------------------

const UsageBar: React.FC<{ label: string; value: number; max: number }> = ({
  label,
  value,
  max,
}) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="label-medium text-on-surface-variant w-28 truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 h-3 rounded-full bg-surface-container-highest overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="label-small text-on-surface-variant w-12 text-right">{value}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dashboard Component
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL = 30_000;

const Dashboard: React.FC = () => {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [modelUsage, setModelUsage] = useState<ModelUsage | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch all dashboard data
  const fetchAll = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [sys, agents, models, act, hp] = await Promise.all([
        monitorApi.getSystemStats(),
        monitorApi.getAgentStats(),
        monitorApi.getModelUsage(),
        monitorApi.getRecentActivity(20),
        monitorApi.getHealth(),
      ]);
      setSystemStats(sys);
      setAgentStats(agents);
      setModelUsage(models);
      setActivity(act || []);
      setHealth(hp);
    } catch (err: any) {
      setSnackbar({ open: true, message: `数据加载失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll(true);
    timerRef.current = setInterval(() => fetchAll(false), REFRESH_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll]);

  // Max value for bar chart
  const maxModelUsage = modelUsage?.usage_by_model?.length
    ? Math.max(...modelUsage.usage_by_model.map((u) => u.message_count), 1)
    : 1;

  return (
    <div className="h-full flex flex-col font-roboto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="title-large text-on-surface">监控仪表盘</h2>
          <p className="body-medium text-on-surface-variant mt-1">
            系统资源、数字员工与模型使用概览
            {systemStats?.hostname && (
              <span className="ml-2 label-small text-on-surface-variant/60">
                @ {systemStats.hostname}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Health dot */}
          {health && (
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${healthDotClass(health.status)}`} />
              <span className="label-medium text-on-surface-variant">
                {health.status === 'healthy'
                  ? '系统正常'
                  : health.status === 'degraded'
                    ? '部分降级'
                    : '系统异常'}
              </span>
            </div>
          )}
          <Button variant="tonal" onClick={() => fetchAll(true)}>
            刷新
          </Button>
        </div>
      </div>

      {loading && !systemStats ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="body-medium text-on-surface-variant">加载中...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pb-4">
          {/* ---- Row 1: Stat Cards ---- */}
          <div className="grid grid-cols-4 gap-4">
            {/* CPU */}
            <Card variant="filled">
              <div className="flex items-center justify-between">
                <div>
                  <p className="label-medium text-on-surface-variant">CPU 使用率</p>
                  <p className="headline-small text-on-surface mt-1">
                    {systemStats ? `${Math.round(systemStats.cpu_percent)}%` : '--'}
                  </p>
                  <p className="label-small text-on-surface-variant/60 mt-0.5">
                    {systemStats ? `${systemStats.cpu_count} 核心` : ''}
                  </p>
                </div>
                {systemStats && <CircularGauge percent={systemStats.cpu_percent} />}
              </div>
            </Card>

            {/* Memory */}
            <Card variant="filled">
              <div className="flex items-center justify-between">
                <div>
                  <p className="label-medium text-on-surface-variant">内存使用</p>
                  <p className="headline-small text-on-surface mt-1">
                    {systemStats ? `${Math.round(systemStats.memory_percent)}%` : '--'}
                  </p>
                  <p className="label-small text-on-surface-variant/60 mt-0.5">
                    {systemStats
                      ? `${systemStats.memory_used_gb} / ${systemStats.memory_total_gb} GB`
                      : ''}
                  </p>
                </div>
                {systemStats && <CircularGauge percent={systemStats.memory_percent} />}
              </div>
            </Card>

            {/* Active Personas */}
            <Card variant="filled">
              <div>
                <p className="label-medium text-on-surface-variant">数字员工</p>
                <p className="headline-small text-on-surface mt-1">
                  {agentStats ? agentStats.active_personas : '--'}
                  <span className="body-small text-on-surface-variant ml-1">
                    / {agentStats?.total_personas ?? 0}
                  </span>
                </p>
                <p className="label-small text-on-surface-variant/60 mt-0.5">活跃 / 总数</p>
              </div>
            </Card>

            {/* Active Teams */}
            <Card variant="filled">
              <div>
                <p className="label-medium text-on-surface-variant">团队</p>
                <p className="headline-small text-on-surface mt-1">
                  {agentStats ? agentStats.active_teams : '--'}
                  <span className="body-small text-on-surface-variant ml-1">
                    / {agentStats?.total_teams ?? 0}
                  </span>
                </p>
                <p className="label-small text-on-surface-variant/60 mt-0.5">活跃 / 总数</p>
              </div>
            </Card>
          </div>

          {/* ---- Row 2: Message stats + Disk ---- */}
          <div className="grid grid-cols-3 gap-4">
            <Card variant="outlined">
              <p className="label-medium text-on-surface-variant">今日消息</p>
              <p className="headline-medium text-on-surface mt-1">
                {agentStats?.messages_today ?? 0}
              </p>
            </Card>
            <Card variant="outlined">
              <p className="label-medium text-on-surface-variant">总消息</p>
              <p className="headline-medium text-on-surface mt-1">
                {agentStats?.total_messages ?? 0}
              </p>
            </Card>
            <Card variant="outlined">
              <div className="flex items-center justify-between">
                <div>
                  <p className="label-medium text-on-surface-variant">磁盘使用</p>
                  <p className="headline-medium text-on-surface mt-1">
                    {systemStats ? `${Math.round(systemStats.disk_percent)}%` : '--'}
                  </p>
                  <p className="label-small text-on-surface-variant/60 mt-0.5">
                    {systemStats
                      ? `${systemStats.disk_used_gb} / ${systemStats.disk_total_gb} GB`
                      : ''}
                  </p>
                </div>
                {systemStats && <CircularGauge percent={systemStats.disk_percent} size={48} />}
              </div>
            </Card>
          </div>

          {/* ---- Row 3: Model Usage + Recent Activity ---- */}
          <div className="grid grid-cols-2 gap-4">
            {/* Model Usage */}
            <Card variant="outlined" className="flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="title-small text-on-surface">模型使用统计</h3>
                <span className="label-small text-on-surface-variant">
                  {modelUsage ? `${modelUsage.active_models}/${modelUsage.total_models} 模型` : ''}
                </span>
              </div>
              {modelUsage?.usage_by_model && modelUsage.usage_by_model.length > 0 ? (
                <div>
                  {modelUsage.usage_by_model.map((item) => (
                    <UsageBar
                      key={item.model_name}
                      label={item.model_name}
                      value={item.message_count}
                      max={maxModelUsage}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center py-8">
                  <p className="body-medium text-on-surface-variant/60">暂无使用数据</p>
                </div>
              )}
            </Card>

            {/* Recent Activity */}
            <Card variant="outlined" className="flex flex-col max-h-80">
              <div className="flex items-center justify-between mb-4">
                <h3 className="title-small text-on-surface">最近活动</h3>
                <span className="label-small text-on-surface-variant">最近 20 条</span>
              </div>
              {activity.length > 0 ? (
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {activity.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors"
                    >
                      {/* Sender avatar */}
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          item.sender_type === 'user'
                            ? 'bg-primary/15 text-primary'
                            : item.sender_type === 'persona'
                              ? 'bg-tertiary/15 text-tertiary'
                              : 'bg-outline/15 text-outline'
                        }`}
                      >
                        <span className="text-[10px] font-bold">
                          {item.sender_type === 'user'
                            ? 'U'
                            : item.persona_name
                              ? item.persona_name[0]
                              : 'S'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="label-small text-on-surface font-medium truncate">
                            {item.persona_name || (item.sender_type === 'user' ? '用户' : '系统')}
                          </span>
                          {item.conversation_title && (
                            <span className="label-small text-on-surface-variant/60 truncate">
                              &middot; {item.conversation_title}
                            </span>
                          )}
                        </div>
                        <p className="body-small text-on-surface-variant truncate">
                          {item.content_preview || '(空消息)'}
                        </p>
                        <p className="label-small text-on-surface-variant/40 mt-0.5">
                          {relativeTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center py-8">
                  <p className="body-medium text-on-surface-variant/60">暂无活动记录</p>
                </div>
              )}
            </Card>
          </div>

          {/* ---- Row 4: Health Details ---- */}
          {health && (
            <Card variant="outlined">
              <h3 className="title-small text-on-surface mb-3">系统健康检查</h3>
              <div className="grid grid-cols-3 gap-4">
                {Object.entries(health.checks).map(([key, check]) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${healthDotClass(check.status)}`} />
                    <div className="min-w-0">
                      <p className="label-medium text-on-surface capitalize">{key}</p>
                      <p className="label-small text-on-surface-variant truncate" title={check.message}>
                        {check.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Snackbar */}
      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default Dashboard;
