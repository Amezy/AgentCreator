/**
 * @module AgentCreatorLayout
 * @description AgentCreator 模块的主布局组件。
 * 左侧子导航（资源池/员工/团队/工作流/监控）+ 中间内容区 + 右下角悬浮聊天气泡。
 * 使用 React Router Outlet 渲染子页面。
 */
import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import SubNav from './components/SubNav';
import ChatPanel from './components/ChatPanel';

const AgentCreatorLayout: React.FC = () => {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="flex h-screen bg-surface font-roboto">
      {/* 左侧：子导航 */}
      <SubNav />

      {/* 中间：内容区域（占满剩余空间） */}
      <main className="flex-1 overflow-y-auto p-8 min-w-0">
        <Outlet />
      </main>

      {/* 右下角悬浮聊天 */}
      {chatOpen ? (
        <div className="fixed right-5 bottom-5 z-50 w-[380px] h-[600px] rounded-2xl shadow-elevation-3 border border-outline-variant/50 overflow-hidden flex flex-col bg-surface">
          <ChatPanel onClose={() => setChatOpen(false)} />
        </div>
      ) : (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed right-5 bottom-5 z-50 w-14 h-14 rounded-full bg-primary text-on-primary shadow-elevation-2 hover:shadow-elevation-3 flex items-center justify-center transition-shadow"
          title="智能助手"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" fill="currentColor"/>
          </svg>
        </button>
      )}
    </div>
  );
};

export default AgentCreatorLayout;
