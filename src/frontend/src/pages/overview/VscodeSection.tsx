/**
 * @module VscodeSection
 * @description VS Code Server 子区块组件。
 * 展示用户的 VS Code Server 安装状态，
 * 提供重新安装按钮以触发后端重新部署。
 * 安装完成后通过轮询检测状态变化。
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SubSection, StatusBadge, icons } from './shared';
import { reinstallVscode, getVscodeStatus } from '../../services/api';
import type { VscodeStatusResponse } from '../../services/api';
import Button from '../../components/m3/Button';

interface Props {
  userId: number;
  status: VscodeStatusResponse | null;
  onReload: () => void;
  toast: (msg: string) => void;
}

/** Polling interval during install (ms) */
const POLL_INTERVAL_MS = 5_000;
/** Max polling duration before giving up (ms) */
const POLL_TIMEOUT_MS = 180_000;

const VscodeSection: React.FC<Props> = ({ userId, status, onReload, toast }) => {
  const [installing, setInstalling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setInstalling(false);
  }, []);

  const startPolling = useCallback(() => {
    pollStartRef.current = Date.now();
    pollTimerRef.current = setInterval(async () => {
      // Timeout check
      if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
        stopPolling();
        toast('安装超时，请检查服务器日志');
        onReload();
        return;
      }

      try {
        const newStatus = await getVscodeStatus(userId);
        if (newStatus.installed) {
          stopPolling();
          toast('VS Code Server 安装完成');
          onReload();
        }
      } catch {
        // Ignore polling errors, will retry
      }
    }, POLL_INTERVAL_MS);
  }, [userId, onReload, toast, stopPolling]);

  const handleReinstall = async () => {
    setInstalling(true);
    try {
      await reinstallVscode(userId);
      toast('VS Code Server 重新安装已启动');
      startPolling();
    } catch (err) {
      setInstalling(false);
      toast(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <SubSection
      icon={icons.vscode}
      title="VS Code Server"
      badge={status?.installed ? '已安装' : '未安装'}
    >
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <StatusBadge ok={status?.installed ?? false} okText="已安装" noText="未安装" />
          <Button variant="outlined" onClick={handleReinstall} disabled={installing}>
            {installing ? '安装中...' : '重新安装'}
          </Button>
        </div>

        {/* UX-02: Show progress during install */}
        {installing && (
          <div className="text-sm text-on-surface-variant flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            正在安装，请稍候...
          </div>
        )}

        {/* UX-03: Show installed extensions and version info */}
        {status?.installed && (
          <div className="text-sm text-on-surface-variant space-y-1">
            {status.commitId && (
              <div>Commit: <span className="font-mono text-xs">{status.commitId.slice(0, 12)}...</span></div>
            )}
            {status.extensions && status.extensions.length > 0 && (
              <div>
                插件: {status.extensions.map((ext) => (
                  <span key={ext} className="inline-block bg-surface-variant rounded px-1.5 py-0.5 mr-1 text-xs font-mono">
                    {ext}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SubSection>
  );
};

export default VscodeSection;
