/**
 * @module App
 * @description 应用根组件，定义全局路由结构。
 *
 * 路由结构：
 * - /                        -> 重定向到 /login
 * - /login                   -> 登录页面
 * - /wizard                  -> 配置向导布局（含侧边导航和步骤条）
 *   - /wizard/user-setup     -> 第1步：用户配置
 *   - /wizard/model-config   -> 第2步：模型配置
 *   - /wizard/team-config    -> 第3步：团队配置
 *   - /wizard/deploy-config  -> 第4步：部署配置
 *   - /wizard/repo-config    -> 第5步：Git 仓库配置
 *   - /wizard/overview       -> 账号概览（管理面板）
 * - *                        -> 未匹配路径重定向到 /login
 */
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WizardLayout from './layouts/WizardLayout';
import Login from './pages/Login';
import UserSetup from './pages/UserSetup';
import ModelConfig from './pages/ModelConfig';
import TeamConfig from './pages/TeamConfig';
import DeployConfig from './pages/DeployConfig';
import RepoConfig from './pages/RepoConfig';
import Overview from './pages/Overview';
import AgentCreatorLayout from './pages/agent-creator';
import ResourcePool from './pages/agent-creator/ResourcePool';
import SkillEditor from './pages/agent-creator/SkillEditor';
import PersonaManager from './pages/agent-creator/PersonaManager';
import TeamManager from './pages/agent-creator/TeamManager';
import WorkflowView from './pages/agent-creator/WorkflowView';
import Monitor from './pages/agent-creator/Monitor';
import Dashboard from './pages/agent-creator/Dashboard';
import Settings from './pages/agent-creator/Settings';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* 根路径重定向到 AgentCreator */}
        <Route path="/" element={<Navigate to="/agent-creator" replace />} />
        {/* 登录页面（独立布局） */}
        <Route path="/login" element={<Login />} />
        {/* 配置向导（嵌套路由，共享 WizardLayout 布局） */}
        <Route path="/wizard" element={<WizardLayout />}>
          <Route index element={<Navigate to="user-setup" replace />} />
          <Route path="user-setup" element={<UserSetup />} />
          <Route path="model-config" element={<ModelConfig />} />
          <Route path="team-config" element={<TeamConfig />} />
          <Route path="deploy-config" element={<DeployConfig />} />
          <Route path="repo-config" element={<RepoConfig />} />
          <Route path="overview" element={<Overview />} />
        </Route>
        {/* 全屏技能编辑器（独立于 AgentCreatorLayout） */}
        <Route path="/agent-creator/skills/:id/edit" element={<SkillEditor />} />
        <Route path="/agent-creator/skills/new" element={<SkillEditor />} />
        {/* AgentCreator 模块（嵌套路由） */}
        <Route path="/agent-creator" element={<AgentCreatorLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="resources" element={<ResourcePool />} />
          <Route path="personas" element={<PersonaManager />} />
          <Route path="teams" element={<TeamManager />} />
          <Route path="workflows" element={<WorkflowView />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        {/* 未匹配路径回退到登录 */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
