/**
 * @module ClaudeAuthDialog
 * @description Claude OAuth 认证弹窗组件。
 * 管理完整的 OAuth PKCE 认证流程：启动认证 -> 展示授权链接 ->
 * 用户输入授权码 -> 提交验证 -> 轮询认证状态直至成功或失败。
 * 关闭弹窗时自动取消未完成的认证会话。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from './shared';
import TextField from '../../components/m3/TextField';
import Button from '../../components/m3/Button';
import {
  startClaudeAuth,
  submitClaudeCode,
  getClaudeAuthLoginStatus,
  cancelClaudeAuth,
} from '../../services/api';
import type { ClaudeAuthLoginStatus } from '../../services/api';

interface Props {
  open: boolean;
  userId: number;
  onClose: () => void;
  onSuccess: () => void;
  toast: (msg: string) => void;
}

type FlowStatus = 'idle' | 'starting' | 'awaiting_code' | 'exchanging' | 'success' | 'failed';

const POLL_INTERVAL_MS = 2000;

const ClaudeAuthDialog: React.FC<Props> = ({ open, userId, onClose, onSuccess, toast }) => {
  const [status, setStatus] = useState<FlowStatus>('idle');
  const [oauthUrl, setOauthUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    cleanup();
    if (sessionId && status !== 'success') {
      cancelClaudeAuth(userId, sessionId).catch(() => {});
    }
    setStatus('idle');
    setOauthUrl('');
    setSessionId('');
    setCode('');
    setError('');
    onClose();
  }, [cleanup, sessionId, status, userId, onClose]);

  // Start auth flow when dialog opens
  useEffect(() => {
    if (!open) return;
    setStatus('starting');
    setError('');
    startClaudeAuth(userId)
      .then((res) => {
        setSessionId(res.sessionId);
        setOauthUrl(res.oauthUrl);
        setStatus('awaiting_code');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
      });
  }, [open, userId]);

  // Poll for status after code submission
  const startPolling = useCallback((sid: string) => {
    cleanup();
    pollRef.current = setInterval(async () => {
      try {
        const res: ClaudeAuthLoginStatus = await getClaudeAuthLoginStatus(userId, sid);
        if (res.status === 'success') {
          cleanup();
          setStatus('success');
          toast('Claude 认证成功');
          onSuccess();
        } else if (res.status === 'failed' || res.status === 'timeout' || res.status === 'cancelled') {
          cleanup();
          setError(res.error || '认证失败');
          setStatus('failed');
        }
      } catch (err) {
        cleanup();
        setError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
      }
    }, POLL_INTERVAL_MS);
  }, [userId, cleanup, toast, onSuccess]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const handleSubmitCode = async () => {
    if (!code.trim()) return;
    setStatus('exchanging');
    setError('');
    try {
      const res = await submitClaudeCode(userId, code.trim(), sessionId);
      if (res.success) {
        setStatus('success');
        toast('Claude 认证成功');
        onSuccess();
      } else {
        startPolling(sessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('failed');
    }
  };

  return (
    <Modal open={open} title="Claude OAuth 认证" onClose={handleClose}>
      <div className="space-y-4">
        {status === 'starting' && (
          <p className="body-medium text-on-surface-variant">正在初始化认证...</p>
        )}

        {status === 'awaiting_code' && (
          <>
            <p className="body-medium text-on-surface">
              请在浏览器中打开以下链接完成授权，然后将授权码粘贴到下方：
            </p>
            <div className="p-3 rounded-lg bg-surface-container-high break-all">
              <a
                href={oauthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="body-small text-primary hover:underline"
              >
                {oauthUrl}
              </a>
            </div>
            <TextField
              label="授权码"
              value={code}
              onChange={setCode}
            />
            <Button variant="filled" onClick={handleSubmitCode} disabled={!code.trim()}>
              提交授权码
            </Button>
          </>
        )}

        {status === 'exchanging' && (
          <p className="body-medium text-on-surface-variant">正在验证授权码...</p>
        )}

        {status === 'success' && (
          <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
            <p className="body-medium text-primary">认证成功！</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="p-4 rounded-lg bg-error/5 border border-error/20">
            <p className="body-medium text-error">{error || '认证失败'}</p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ClaudeAuthDialog;
