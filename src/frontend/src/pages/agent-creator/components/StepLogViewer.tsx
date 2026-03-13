import React, { useState } from 'react';
import { executionApi, type StepLogEntry } from '../../../services/agentCreatorApi';

interface StepInfo {
  step_number: number;
  step_label: string;
  status: string;
  tokens_used: number;
  tool_calls_count: number;
  summary_json: { key_findings?: string[]; artifacts?: { type: string; content: string }[]; context_for_next?: string } | null;
  started_at: string | null;
  completed_at: string | null;
}

interface StepLogViewerProps {
  executionId: string;
  step: StepInfo;
}

const StepLogViewer: React.FC<StepLogViewerProps> = ({ executionId, step }) => {
  const [expanded, setExpanded] = useState(false);
  const [logEntries, setLogEntries] = useState<StepLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const toggleExpand = async () => {
    if (!expanded && logEntries === null) {
      setLoading(true);
      setLoadError(null);
      try {
        const entries = await executionApi.getStepLog(executionId, step.step_number);
        setLogEntries(entries);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '日志加载失败');
        setLogEntries([]);
      }
      setLoading(false);
    }
    setExpanded(!expanded);
  };

  const duration = step.started_at && step.completed_at
    ? `${((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000).toFixed(0)}s`
    : step.started_at ? '进行中' : '--';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Step header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={toggleExpand}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-800">
            步骤 {step.step_number}: {step.step_label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{duration}</span>
          <span>{step.tool_calls_count} 次调用</span>
          <span>{step.tokens_used?.toLocaleString() ?? 0} tokens</span>
          <span className="text-blue-600">{expanded ? '收起' : '展开'}</span>
        </div>
      </div>

      {/* Summary */}
      {step.summary_json && (
        <div className="px-4 py-2 border-t border-gray-100">
          <div className="text-xs text-gray-600">
            {step.summary_json.key_findings?.map((f, i) => (
              <span key={i} className="inline-block bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 mr-1 mb-1">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Expanded raw log */}
      {expanded && (
        <div className="border-t border-gray-200 bg-gray-900 text-gray-100 p-3 max-h-64 overflow-y-auto font-mono text-xs">
          {loading ? (
            <p className="text-gray-400">加载日志中...</p>
          ) : loadError ? (
            <p className="text-red-400">加载日志失败: {loadError}</p>
          ) : logEntries && logEntries.length > 0 ? (
            logEntries.map((entry, i) => {
              const ts = entry.timestamp
                ? new Date(entry.timestamp * 1000).toLocaleTimeString()
                : '';
              return (
                <div key={i} className="py-0.5">
                  <span className="text-gray-500">[{ts}]</span>{' '}
                  <span className="text-yellow-300">{entry.type ?? 'log'}</span>{' '}
                  <span>{JSON.stringify(entry, null, 0).slice(0, 200)}</span>
                </div>
              );
            })
          ) : (
            <p className="text-gray-500">暂无日志记录</p>
          )}
        </div>
      )}
    </div>
  );
};

export default StepLogViewer;
