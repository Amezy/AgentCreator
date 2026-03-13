import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { executionApi, type ExecutionInfo, type StepInfo, type ContextStatus } from '../../services/agentCreatorApi';
import ContextStatusBar from './components/ContextStatusBar';
import StepLogViewer from './components/StepLogViewer';

const POLL_INTERVAL_MS = 5000;
const POLL_BACKOFF_MS = 15000;

const ExecutionMonitor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [execution, setExecution] = useState<ExecutionInfo | null>(null);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [compacting, setCompacting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const consecutiveErrorsRef = React.useRef(0);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [execData, stepsData, ctxData] = await Promise.all([
        executionApi.get(id),
        executionApi.getSteps(id),
        executionApi.getContextStatus(id),
      ]);
      setExecution(execData);
      setSteps(stepsData);
      setContextStatus(ctxData);
      setFetchError(null);
      consecutiveErrorsRef.current = 0;
    } catch (e) {
      consecutiveErrorsRef.current += 1;
      setFetchError(e instanceof Error ? e.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      if (execution?.status === 'running') {
        fetchData();
      }
    }, consecutiveErrorsRef.current >= 2 ? POLL_BACKOFF_MS : POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData, execution?.status]);

  const handleCompact = async () => {
    if (!id) return;
    setCompacting(true);
    try {
      await executionApi.compact(id);
      await fetchData();
    } finally {
      setCompacting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">未找到执行记录</p>
      </div>
    );
  }

  const STATUS_LABELS: Record<string, string> = {
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '执行失败',
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-gray-500 hover:text-gray-700 mb-2"
            >
              &larr; 返回
            </button>
            <h1 className="text-xl font-semibold text-gray-900">{execution.task_title}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                execution.status === 'completed' ? 'bg-green-100 text-green-700' :
                execution.status === 'running' ? 'bg-blue-100 text-blue-700' :
                execution.status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {STATUS_LABELS[execution.status] ?? execution.status}
              </span>
              <span>{execution.completed_steps}/{execution.total_steps} 步</span>
              <span>{execution.total_tokens_used?.toLocaleString() ?? 0} tokens</span>
            </div>
          </div>
          <button
            disabled
            className="text-xs px-3 py-1.5 border border-gray-300 text-gray-400 rounded cursor-not-allowed"
            title="导出日志（即将推出）"
          >
            导出日志
          </button>
        </div>

        {/* Error banner */}
        {fetchError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <span className="text-sm text-red-700">数据加载失败: {fetchError}</span>
            <button onClick={fetchData} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">
              重试
            </button>
          </div>
        )}

        {/* Context Status Bar */}
        <div className="mb-6">
          <ContextStatusBar
            status={contextStatus}
            onCompact={handleCompact}
            compacting={compacting}
          />
        </div>

        {/* Steps List */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">执行步骤</h2>
          {steps.map((step) => (
            <StepLogViewer
              key={step.step_number}
              executionId={id!}
              step={step}
            />
          ))}
          {steps.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">此工作流没有执行步骤</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionMonitor;
