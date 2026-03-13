/**
 * @module NavigationDrawer
 * @description Material Design 3 侧边导航抽屉组件。
 * 固定宽度 256px，支持自定义头部和底部内容，
 * 导航项通过图标名称映射到内联 SVG 图标。
 */
import React from 'react';

/** 单个导航项定义 */
interface NavItem {
  /** 图标名称，映射到 iconMap */
  icon: string;
  /** 导航项显示文本 */
  label: string;
  /** 路由路径 */
  path: string;
  /** 是否激活（由外部 activeItem 控制） */
  active?: boolean;
}

/**
 * NavigationDrawer 组件属性
 * @property items - 导航项列表
 * @property activeItem - 当前激活的路径
 * @property onItemClick - 导航项点击回调
 * @property header - 自定义头部内容
 * @property footer - 自定义底部内容
 */
interface NavigationDrawerProps {
  items: NavItem[];
  activeItem: string;
  onItemClick: (path: string) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

// Map icon names to inline SVG components
const iconMap: Record<string, React.ReactNode> = {
  settings: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
        fill="currentColor"
      />
    </svg>
  ),
  dashboard: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"
        fill="currentColor"
      />
    </svg>
  ),
  user: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
        fill="currentColor"
      />
    </svg>
  ),
  box: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 7l-8-4-8 4v10l8 4 8-4V7zm-8-1.8L17.6 8 12 10.8 6.4 8 12 5.2zM5 9.24l6 3v6.52l-6-3V9.24zm8 9.52v-6.52l6-3v6.52l-6 3z"
        fill="currentColor"
      />
    </svg>
  ),
  logout: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"
        fill="currentColor"
      />
    </svg>
  ),
  agent: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
        fill="currentColor"
      />
    </svg>
  ),
};

const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  items,
  activeItem,
  onItemClick,
  header,
  footer,
}) => {
  return (
    <nav className="w-64 h-full bg-surface-container-low flex flex-col font-roboto border-r border-outline-variant">
      {/* Header */}
      {header && (
        <div className="px-7 pt-6 pb-4">
          {header}
        </div>
      )}

      {/* Navigation Items */}
      <div className="flex-1 px-3 py-2 space-y-1">
        {items.map((item) => {
          const isActive = item.path === activeItem;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => onItemClick(item.path)}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-xl
                transition-all duration-200 text-left state-layer
                ${
                  isActive
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-on-surface/[0.08]'
                }
              `}
            >
              {/* Icon */}
              <span className={`shrink-0 ${isActive ? 'text-on-secondary-container' : 'text-on-surface-variant'}`}>
                {iconMap[item.icon] || iconMap.user}
              </span>

              {/* Label */}
              <span className={`label-large ${isActive ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {footer && (
        <div className="px-3 pb-4">
          {footer}
        </div>
      )}
    </nav>
  );
};

export default NavigationDrawer;
