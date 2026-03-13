/**
 * @module Snackbar
 * @description Material Design 3 底部通知条组件。
 * 固定在页面底部居中显示，支持自动消失（默认 4 秒）、
 * 自定义操作按钮和手动关闭，带入场动画。
 */
import React, { useEffect } from 'react';
import { CloseIcon } from '../icons/Icons';

/**
 * Snackbar 组件属性
 * @property message - 通知消息内容
 * @property open - 是否显示
 * @property onClose - 关闭回调
 * @property action - 可选的操作按钮（label + onClick）
 * @property duration - 自动关闭时间（毫秒），默认 4000
 */
interface SnackbarProps {
  message: string;
  open: boolean;
  onClose: () => void;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

const Snackbar: React.FC<SnackbarProps> = ({
  message,
  open,
  onClose,
  action,
  duration = 4000,
}) => {
  useEffect(() => {
    if (open && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [open, duration, onClose]);

  if (!open) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-snackbar-in">
      <div className="flex items-center gap-2 px-4 py-3 bg-inverse-surface text-inverse-on-surface rounded-xs shadow-elevation-3 min-w-[288px] max-w-[560px] font-roboto">
        {/* Message */}
        <p className="body-medium flex-1">{message}</p>

        {/* Action Button */}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="label-large text-inverse-primary hover:opacity-80 px-2 py-1 shrink-0"
          >
            {action.label}
          </button>
        )}

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="text-inverse-on-surface hover:opacity-80 p-1 shrink-0"
          aria-label="关闭"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <style>{`
        @keyframes snackbar-in {
          from {
            opacity: 0;
            transform: translate(-50%, 20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
        .animate-snackbar-in {
          animation: snackbar-in 200ms ease-out;
        }
      `}</style>
    </div>
  );
};

export default Snackbar;
