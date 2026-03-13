/**
 * @module SegmentedButton
 * @description Material Design 3 分段按钮组件。
 * 多选一的切换控件，选中项带勾选图标高亮显示，
 * 支持禁用单个选项。
 */
import React from 'react';
import { CheckIcon } from '../icons/Icons';

/**
 * SegmentedButton 组件属性
 * @property options - 选项列表，每项包含 label、value 和可选的 disabled
 * @property selected - 当前选中值
 * @property onChange - 选中值变化回调
 */
interface SegmentedButtonProps {
  options: { label: string; value: string; disabled?: boolean }[];
  selected: string;
  onChange: (value: string) => void;
}

const SegmentedButton: React.FC<SegmentedButtonProps> = ({
  options,
  selected,
  onChange,
}) => {
  return (
    <div className="inline-flex border border-outline rounded-xl overflow-hidden font-roboto">
      {options.map((option, index) => {
        const isSelected = option.value === selected;
        const isDisabled = option.disabled;

        return (
          <button
            key={option.value}
            type="button"
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(option.value)}
            className={`
              relative flex items-center justify-center gap-2 px-4 h-10 label-large
              transition-all duration-200 outline-none
              ${index > 0 ? 'border-l border-outline' : ''}
              ${
                isSelected
                  ? 'bg-secondary-container text-on-secondary-container'
                  : isDisabled
                  ? 'bg-surface text-on-surface/[0.38] cursor-not-allowed'
                  : 'bg-surface text-on-surface hover:bg-on-surface/[0.08] cursor-pointer state-layer'
              }
            `}
          >
            {isSelected && (
              <CheckIcon size={18} className="text-on-secondary-container" />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedButton;
