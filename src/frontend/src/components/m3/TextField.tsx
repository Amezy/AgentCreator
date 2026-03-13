/**
 * @module TextField
 * @description Material Design 3 文本输入框组件。
 * 带浮动标签动画，支持密码可见性切换、错误状态显示、
 * 辅助文本提示和自定义尾部图标。
 */
import React, { useState, useId } from 'react';
import { EyeIcon, EyeOffIcon } from '../icons/Icons';

/**
 * TextField 组件属性
 * @property label - 浮动标签文本
 * @property type - 输入类型：'text' | 'password' | 'email'
 * @property value - 受控输入值
 * @property onChange - 值变化回调，传入新值字符串
 * @property error - 错误提示文本，非空时显示错误样式
 * @property helperText - 辅助说明文本
 * @property trailingIcon - 自定义尾部图标
 */
interface TextFieldProps {
  label: string;
  type?: 'text' | 'password' | 'email';
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  trailingIcon?: React.ReactNode;
}

const TextField: React.FC<TextFieldProps> = ({
  label,
  type = 'text',
  value,
  onChange,
  error,
  helperText,
  trailingIcon,
}) => {
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const id = useId();

  const isPassword = type === 'password';
  const inputType = isPassword ? (passwordVisible ? 'text' : 'password') : type;

  const hasValue = value.length > 0;
  const isFloating = focused || hasValue;

  const borderColor = error
    ? 'border-error'
    : focused
    ? 'border-primary'
    : 'border-outline';

  const labelColor = error
    ? 'text-error'
    : focused
    ? 'text-primary'
    : 'text-on-surface-variant';

  return (
    <div className="w-full font-roboto">
      <div className={`relative border rounded-xs ${borderColor} ${focused ? 'border-2' : 'border'} transition-colors duration-200`}>
        {/* Floating Label */}
        <label
          htmlFor={id}
          className={`absolute left-3 transition-all duration-200 pointer-events-none ${labelColor} ${
            isFloating
              ? '-top-2.5 text-xs bg-surface px-1'
              : 'top-4 text-base'
          }`}
        >
          {label}
        </label>

        {/* Input */}
        <input
          id={id}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`w-full px-4 pt-4 pb-3 bg-transparent text-on-surface body-large outline-none ${
            isPassword || trailingIcon ? 'pr-12' : ''
          }`}
          autoComplete={isPassword ? 'new-password' : undefined}
        />

        {/* Trailing Icon Area */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setPasswordVisible(!passwordVisible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1 rounded-full state-layer"
            tabIndex={-1}
            aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
          >
            {passwordVisible ? (
              <EyeIcon size={20} />
            ) : (
              <EyeOffIcon size={20} />
            )}
          </button>
        )}
        {!isPassword && trailingIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
            {trailingIcon}
          </span>
        )}
      </div>

      {/* Helper / Error Text */}
      {(error || helperText) && (
        <p
          className={`mt-1 ml-4 body-small ${
            error ? 'text-error' : 'text-on-surface-variant'
          }`}
        >
          {error || helperText}
        </p>
      )}
    </div>
  );
};

export default TextField;
