/**
 * @module Button
 * @description Material Design 3 按钮组件。
 * 提供四种样式变体：filled（实心）、tonal（色调）、outlined（描边）、text（文本），
 * 内置 ripple 水波纹点击效果，支持前置图标和禁用状态。
 */
import React, { useCallback, useRef } from 'react';

/**
 * Button 组件属性
 * @property variant - 按钮样式变体：'filled' | 'tonal' | 'outlined' | 'text'
 * @property children - 按钮文本内容
 * @property onClick - 点击回调
 * @property disabled - 是否禁用
 * @property className - 附加的 CSS 类名
 * @property type - HTML button type，默认 'button'
 * @property icon - 前置图标 ReactNode
 */
interface ButtonProps {
  variant: 'filled' | 'tonal' | 'outlined' | 'text';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  icon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant,
  children,
  onClick,
  disabled = false,
  className = '',
  type = 'button',
  icon,
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;

      // Ripple effect
      const button = buttonRef.current;
      if (button) {
        const rect = button.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.width = ripple.style.height = `${Math.max(rect.width, rect.height)}px`;
        button.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      }

      onClick?.();
    },
    [disabled, onClick]
  );

  const baseClasses =
    'relative overflow-hidden inline-flex items-center justify-center gap-2 px-6 h-10 rounded-xl label-large font-roboto transition-all duration-200 cursor-pointer select-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2';

  const variantClasses = {
    filled: disabled
      ? 'bg-on-surface/[0.12] text-on-surface/[0.38] cursor-not-allowed'
      : 'bg-primary text-on-primary hover:shadow-elevation-1 active:shadow-none focus-visible:outline-primary',
    tonal: disabled
      ? 'bg-on-surface/[0.12] text-on-surface/[0.38] cursor-not-allowed'
      : 'bg-secondary-container text-on-secondary-container hover:shadow-elevation-1 active:shadow-none focus-visible:outline-secondary',
    outlined: disabled
      ? 'border border-on-surface/[0.12] text-on-surface/[0.38] cursor-not-allowed'
      : 'border border-outline text-primary hover:bg-primary/[0.08] active:bg-primary/[0.12] focus-visible:outline-primary',
    text: disabled
      ? 'text-on-surface/[0.38] cursor-not-allowed'
      : 'text-primary hover:bg-primary/[0.08] active:bg-primary/[0.12] px-3 focus-visible:outline-primary',
  };

  return (
    <button
      ref={buttonRef}
      type={type}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      onClick={handleClick}
      disabled={disabled}
    >
      {icon && <span className="flex items-center -ml-1">{icon}</span>}
      {children}
    </button>
  );
};

export default Button;
