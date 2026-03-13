/**
 * @module SubNav
 * @description AgentCreator 左侧子导航组件。
 * 复用 M3 设计语言，提供资源池/员工/团队/工作流/监控的导航切换。
 */
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface NavItem {
  icon: React.ReactNode;
  label: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: '仪表盘',
    path: '/agent-creator/dashboard',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: '资源池',
    path: '/agent-creator/resources',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: '员工管理',
    path: '/agent-creator/personas',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: '团队管理',
    path: '/agent-creator/teams',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: '工作流',
    path: '/agent-creator/workflows',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: '监控',
    path: '/agent-creator/monitor',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M19.88 18.47c.44-.7.7-1.51.7-2.39 0-2.49-2.01-4.5-4.5-4.5s-4.5 2.01-4.5 4.5 2.01 4.5 4.5 4.5c.88 0 1.69-.26 2.39-.7L21.58 23 23 21.58l-3.12-3.11zm-3.8.11c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zm-.36-8.5c-.74.02-1.45.18-2.1.45l-.55-.83-3.8 6.18-3.01-3.52-3.63 5.81L1 17l5-8 3 3.5L13 6l2.72 4.08z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: '设置',
    path: '/agent-creator/settings',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill="currentColor"/>
      </svg>
    ),
  },
];

const SubNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="w-56 h-full bg-surface-container-low flex flex-col font-roboto border-r border-outline-variant">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
            </svg>
          </div>
          <div>
            <h1 className="title-medium text-on-surface leading-tight">数字员工</h1>
            <p className="label-small text-on-surface-variant">AgentCreator</p>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 px-3 py-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
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
              <span className={`shrink-0 ${isActive ? 'text-on-secondary-container' : 'text-on-surface-variant'}`}>
                {item.icon}
              </span>
              <span className={`label-large ${isActive ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer: 返回主系统 */}
      <div className="px-3 pb-4">
        <button
          type="button"
          onClick={() => navigate('/wizard/overview')}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-on-surface-variant hover:bg-on-surface/[0.08] transition-all duration-200 text-left state-layer"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor"/>
          </svg>
          <span className="label-large font-medium">返回管理系统</span>
        </button>
      </div>
    </nav>
  );
};

export default SubNav;
