/**
 * @module TeamConfig
 * @description Agent 团队配置页面 - 配置向导的第三步。
 * 基于 Superpowers 工作流范式组建 AI 开发团队，包含五种角色：
 * 架构师、前端开发、后端开发、代码审查、DevOps。
 * 支持调整可变角色的人数，并为每个角色分配已验证的模型。
 */
import React, { useEffect } from 'react';
import Card from '../components/m3/Card';
import TextField from '../components/m3/TextField';
import NumberStepper from '../components/m3/NumberStepper';
import { CheckIcon } from '../components/icons/Icons';
import useWizardStore from '../store/wizardStore';

// Role icon SVGs
const roleIcons: Record<string, React.ReactNode> = {
  architect: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z" fill="currentColor"/>
    </svg>
  ),
  frontend: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" fill="currentColor"/>
    </svg>
  ),
  backend: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" fill="currentColor"/>
    </svg>
  ),
  reviewer: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" fill="currentColor"/>
    </svg>
  ),
  devops: (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill="currentColor"/>
    </svg>
  ),
};

// Role descriptions
const roleDescriptions: Record<string, string> = {
  architect: '需求脑暴 · 方案设计 · 任务拆解',
  frontend: 'TDD 驱动 · UI 组件 · 交互实现',
  backend: 'TDD 驱动 · API 设计 · 数据层',
  reviewer: '规范合规 · 质量评审 · 两阶段审查',
  devops: 'Git 工作树 · CI/CD · 分支管理',
};

// Superpowers skills per role
const roleSkills: Record<string, string[]> = {
  architect: ['brainstorming', 'writing-plans', 'executing-plans'],
  frontend: ['test-driven-development', 'subagent-driven-development'],
  backend: ['test-driven-development', 'subagent-driven-development'],
  reviewer: ['requesting-code-review', 'receiving-code-review', 'verification-before-completion'],
  devops: ['using-git-worktrees', 'finishing-a-development-branch', 'dispatching-parallel-agents'],
};

const TeamConfig: React.FC = () => {
  const { teamConfig, setTeamConfig, updateAgent, setStepValid, modelConfig, showValidationErrors } = useWizardStore();

  // Get verified models for model assignment dropdown
  const verifiedModels = modelConfig.models.filter((m) => m.verified);

  // Auto-assign first verified model to unassigned agents
  useEffect(() => {
    if (verifiedModels.length === 0) return;
    const firstModel = verifiedModels[0].modelId;
    teamConfig.agents.forEach((agent, index) => {
      if (agent.assignedModel === '') {
        updateAgent(index, { assignedModel: firstModel });
      }
    });
  }, [verifiedModels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Valid when configName is set and all agents have assigned models
  useEffect(() => {
    if (verifiedModels.length === 0 || !teamConfig.configName.trim()) {
      setStepValid(false);
      return;
    }
    const allAssigned = teamConfig.agents.every((a) => a.assignedModel !== '');
    setStepValid(allAssigned);
    return () => setStepValid(false);
  }, [teamConfig.agents, teamConfig.configName, verifiedModels.length, setStepValid]);

  const totalAgents = teamConfig.agents.reduce((sum, a) => sum + a.count, 0);

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="headline-small text-on-surface mb-2">Agent 团队配置</h2>
      <p className="body-medium text-on-surface-variant mb-6">
        基于{' '}
        <a
          href="https://github.com/obra/superpowers"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          Superpowers
        </a>
        {' '}工作流范式组建 AI 开发团队。为每个角色分配已验证的模型。
      </p>

      {/* Team Name */}
      <div className="mb-6">
        <TextField
          label="团队名称"
          value={teamConfig.configName}
          onChange={(value) => setTeamConfig({ configName: value })}
          error={showValidationErrors && !teamConfig.configName.trim() ? '请输入团队名称' : undefined}
          helperText={'为该 Agent 团队配置命名，如\u201C默认团队\u201D、\u201C前端加强版\u201D等'}
        />
      </div>

      {verifiedModels.length === 0 && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-error-container/40 border border-error/20">
          <p className="body-medium text-error">请先在"模型配置"步骤中验证至少一个模型，才能分配给团队角色。</p>
        </div>
      )}

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {teamConfig.agents.map((agent, index) => (
          <Card key={agent.role} variant="outlined" className="flex flex-col">
            {/* Header: Icon + Label + Count */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0">
                {roleIcons[agent.role] || roleIcons.architect}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="title-medium text-on-surface whitespace-nowrap">{agent.label}</h3>
                <p className="body-small text-on-surface-variant whitespace-nowrap">
                  {roleDescriptions[agent.role] || ''}
                </p>
              </div>
              <div className="flex-shrink-0">
                {agent.fixed ? (
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-highest title-medium text-on-surface-variant">
                    {agent.count}
                  </span>
                ) : (
                  <NumberStepper
                    value={agent.count}
                    min={agent.min}
                    max={agent.max}
                    onChange={(value) => updateAgent(index, { count: value })}
                  />
                )}
              </div>
            </div>

            {/* Model Assignment */}
            {(() => {
              const needsAttention = showValidationErrors && agent.assignedModel === '';
              return (
                <div className={`mb-3 pt-3 border-t transition-colors duration-300 ${
                  needsAttention ? 'border-error bg-error/5 -mx-6 px-6 rounded-b-md' : 'border-outline-variant'
                }`}>
                  <label className={`label-small mb-1.5 block ${needsAttention ? 'text-error font-medium' : 'text-on-surface-variant'}`}>
                    {needsAttention ? '请选择模型' : '分配模型'}
                  </label>
                  {verifiedModels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {verifiedModels.map((m) => {
                        const isAssigned = agent.assignedModel === m.modelId;
                        return (
                          <button
                            key={m.modelId}
                            type="button"
                            onClick={() => updateAgent(index, { assignedModel: m.modelId })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg label-medium transition-all duration-200 ${
                              isAssigned
                                ? 'bg-primary text-on-primary'
                                : needsAttention
                                ? 'bg-error/10 text-error border border-error/40 hover:bg-error/20 animate-pulse'
                                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-highest'
                            }`}
                          >
                            {isAssigned && <CheckIcon size={14} />}
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={`body-small ${needsAttention ? 'text-error' : 'text-on-surface-variant/60'}`}>
                      {needsAttention ? '请先在"模型配置"中验证模型' : '无可用模型'}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Skills tags */}
            <div className="flex flex-wrap gap-1.5 mt-auto pt-3 border-t border-outline-variant">
              {(roleSkills[agent.role] || []).map((skill) => (
                <span
                  key={skill}
                  className="inline-block px-2 py-0.5 rounded-md bg-secondary-container text-on-secondary-container label-small"
                >
                  {skill}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Team Summary */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface-container">
        <span className="body-medium text-on-surface-variant">团队总人数</span>
        <span className="title-medium text-on-surface">{totalAgents} 个 Agent</span>
      </div>
    </div>
  );
};

export default TeamConfig;
