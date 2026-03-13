/**
 * @module ClaudeAuthSection
 * @description Claude 认证子区块组件。
 * 展示用户的 Claude OAuth 认证状态和过期时间，
 * 提供开始认证和退出认证的操作入口。
 */
import React from 'react';
import { SubSection, StatusBadge, icons } from './shared';
import { logoutClaude } from '../../services/api';
import type { ClaudeAuthCheckResponse } from '../../services/api';
import Button from '../../components/m3/Button';

interface Props {
  userId: number;
  auth: ClaudeAuthCheckResponse | null;
  onStartAuth: () => void;
  onReload: () => void;
  toast: (msg: string) => void;
}

const ClaudeAuthSection: React.FC<Props> = ({ userId, auth, onStartAuth, onReload, toast }) => {
  const handleLogout = async () => {
    try {
      await logoutClaude(userId);
      toast('已退出 Claude 认证');
      onReload();
    } catch (err) {
      toast(`退出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const isAuth = auth?.authenticated ?? false;

  return (
    <SubSection
      icon={icons.claude}
      title="Claude 认证"
      badge={isAuth ? '已认证' : '未认证'}
    >
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <StatusBadge ok={isAuth} okText="已认证" noText="未认证" />
          {isAuth && auth?.email && (
            <span className="body-small text-on-surface-variant">
              {auth.email}
            </span>
          )}
          {isAuth && auth?.expiresAt && (
            <span className="body-small text-on-surface-variant">
              过期时间: {new Date(auth.expiresAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {!isAuth && (
            <Button variant="filled" onClick={onStartAuth}>
              开始认证
            </Button>
          )}
          {isAuth && (
            <Button variant="outlined" onClick={handleLogout}>
              退出认证
            </Button>
          )}
        </div>
      </div>
    </SubSection>
  );
};

export default ClaudeAuthSection;
