/**
 * @module NumberStepper
 * @description 数值步进器组件。
 * 提供加减按钮调整数值，支持最小/最大值限制，
 * 到达边界时自动禁用对应按钮。
 */
import React from 'react';
import { PlusIcon, MinusIcon } from '../icons/Icons';

/**
 * NumberStepper 组件属性
 * @property value - 当前数值
 * @property min - 最小值
 * @property max - 最大值
 * @property onChange - 数值变化回调
 * @property label - 可选的前置标签文本
 */
interface NumberStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label?: string;
}

const NumberStepper: React.FC<NumberStepperProps> = ({
  value,
  min,
  max,
  onChange,
  label,
}) => {
  const canDecrement = value > min;
  const canIncrement = value < max;

  return (
    <div className="flex items-center gap-3 font-roboto">
      {label && (
        <span className="body-medium text-on-surface-variant mr-1">{label}</span>
      )}

      {/* Decrement Button */}
      <button
        type="button"
        onClick={() => canDecrement && onChange(value - 1)}
        disabled={!canDecrement}
        className={`
          flex items-center justify-center w-9 h-9 rounded-full border
          transition-all duration-200
          ${
            canDecrement
              ? 'border-outline text-primary hover:bg-primary/[0.08] active:bg-primary/[0.12] cursor-pointer state-layer'
              : 'border-on-surface/[0.12] text-on-surface/[0.38] cursor-not-allowed'
          }
        `}
        aria-label="减少"
      >
        <MinusIcon size={18} />
      </button>

      {/* Value Display */}
      <span className="title-medium text-on-surface w-8 text-center select-none">
        {value}
      </span>

      {/* Increment Button */}
      <button
        type="button"
        onClick={() => canIncrement && onChange(value + 1)}
        disabled={!canIncrement}
        className={`
          flex items-center justify-center w-9 h-9 rounded-full border
          transition-all duration-200
          ${
            canIncrement
              ? 'border-outline text-primary hover:bg-primary/[0.08] active:bg-primary/[0.12] cursor-pointer state-layer'
              : 'border-on-surface/[0.12] text-on-surface/[0.38] cursor-not-allowed'
          }
        `}
        aria-label="增加"
      >
        <PlusIcon size={18} />
      </button>
    </div>
  );
};

export default NumberStepper;
