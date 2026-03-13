/**
 * @module Tabs
 * @description Material Design 3 标签页组件。
 * 水平排列的标签切换控件，激活标签底部显示主色指示条，
 * 带 ripple 水波纹点击效果。
 */
import React, { useRef, useCallback } from 'react';

/**
 * Tabs 组件属性
 * @property tabs - 标签项数组，每项包含 label 和 value
 * @property activeTab - 当前激活标签的 value
 * @property onChange - 标签切换回调，传入新的 value
 */
interface TabsProps {
  tabs: { label: string; value: string }[];
  activeTab: string;
  onChange: (value: string) => void;
}

const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange }) => {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const handleClick = useCallback(
    (value: string, e: React.MouseEvent<HTMLButtonElement>) => {
      // Ripple effect
      const button = e.currentTarget;
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

      onChange(value);
    },
    [onChange]
  );

  return (
    <div className="flex border-b border-surface-variant font-roboto">
      {tabs.map((tab, index) => {
        const isActive = tab.value === activeTab;

        return (
          <button
            key={tab.value}
            ref={(el) => { tabsRef.current[index] = el; }}
            type="button"
            onClick={(e) => handleClick(tab.value, e)}
            className={`
              relative flex-1 flex items-center justify-center px-4 h-12
              transition-colors duration-200 overflow-hidden
              ${
                isActive
                  ? 'text-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/[0.08]'
              }
            `}
          >
            <span className="title-small">{tab.label}</span>

            {/* Active Indicator */}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary rounded-t-full" />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
