import React from 'react';

interface ContextStatus {
  total_capacity: number;
  used_tokens: number;
  usage_percent: number;
  auto_compact_enabled: boolean;
  estimated_compact_at_step: number | null;
  steps_breakdown: {
    step_number: number;
    label: string;
    tokens: number;
    status: string;
  }[];
}

interface ContextStatusBarProps {
  status: ContextStatus | null;
  onCompact: () => void;
  compacting: boolean;
}

const TOKEN_THRESHOLD_CRITICAL = 90;
const TOKEN_THRESHOLD_WARNING = 70;

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-400',
  running: 'bg-blue-400',
  pending: 'bg-gray-300',
  failed: 'bg-red-400',
};

const ContextStatusBar: React.FC<ContextStatusBarProps> = ({ status, onCompact, compacting }) => {
  if (!status) return null;

  const getBarColor = (percent: number) => {
    if (percent >= TOKEN_THRESHOLD_CRITICAL) return 'bg-red-500';
    if (percent >= TOKEN_THRESHOLD_WARNING) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">上下文使用状态</h3>
        <div className="flex items-center gap-2">
          {status.auto_compact_enabled && (
            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
              Auto Compact 已启用
            </span>
          )}
          <button
            onClick={onCompact}
            disabled={compacting}
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {compacting ? '压缩中...' : '手动压缩'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full transition-all duration-500 ${getBarColor(status.usage_percent)}`}
          style={{ width: `${Math.min(status.usage_percent, 100)}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
          {status.usage_percent.toFixed(1)}% 已使用
        </span>
      </div>

      {/* Token counts */}
      <div className="flex justify-between text-xs text-gray-500 mb-3">
        <span>{status.used_tokens.toLocaleString()} tokens 已用</span>
        <span>{status.total_capacity.toLocaleString()} tokens 总容量</span>
      </div>

      {/* Steps breakdown */}
      {status.steps_breakdown.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 mb-1">各步骤 Token 占用:</p>
          {status.steps_breakdown.map((step) => (
            <div key={step.step_number} className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[step.status] ?? 'bg-gray-300'}`} />
              <span className="text-gray-600 w-20 truncate">{step.label}</span>
              <div className="flex-1 bg-gray-100 rounded h-1.5">
                <div
                  className={`h-full rounded ${STATUS_COLORS[step.status] ?? 'bg-gray-300'}`}
                  style={{
                    width: `${status.total_capacity > 0 ? (step.tokens / status.total_capacity) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-gray-500 w-16 text-right">{step.tokens.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContextStatusBar;
