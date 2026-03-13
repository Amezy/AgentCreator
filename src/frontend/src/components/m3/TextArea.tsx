/**
 * @module TextArea
 * @description Material Design 3 多行文本输入框组件。
 * 带浮动标签动画，支持错误状态显示、辅助文本提示，
 * 可通过 rows 控制初始行数，支持垂直拖拽调整大小。
 */
import React, { useState, useId } from 'react';

/**
 * TextArea 组件属性
 * @property label - 浮动标签文本
 * @property value - 受控输入值
 * @property onChange - 值变化回调，传入新值字符串
 * @property error - 错误提示文本，非空时显示错误样式
 * @property helperText - 辅助说明文本
 * @property rows - 初始显示行数，默认 3
 */
interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  rows?: number;
}

const TextArea: React.FC<TextAreaProps> = ({
  label,
  value,
  onChange,
  error,
  helperText,
  rows = 3,
}) => {
  const [focused, setFocused] = useState(false);
  const id = useId();

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

        {/* Textarea */}
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={rows}
          className="w-full px-4 pt-5 pb-3 bg-transparent text-on-surface body-large outline-none resize-y min-h-[80px]"
        />
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

export default TextArea;
