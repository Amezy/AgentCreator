/**
 * @module WizardLayout
 * @description 配置向导的主布局组件。
 * 左侧固定导航抽屉（账号配置/账号概览切换），右侧包含步骤指示器、
 * 内容区域和底部操作栏。管理五步配置向导的导航逻辑和最终提交流程：
 * 用户配置 -> 模型配置 -> 团队配置 -> 部署配置 -> Git 配置 -> 提交保存。
 * 概览页面隐藏步骤条和底部操作栏，展示独立的管理面板。
 */
import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import NavigationDrawer from '../components/m3/NavigationDrawer';
import Stepper from '../components/m3/Stepper';
import Button from '../components/m3/Button';
import Snackbar from '../components/m3/Snackbar';
import Card from '../components/m3/Card';
import { ArrowLeftIcon, ArrowRightIcon } from '../components/icons/Icons';
import useWizardStore from '../store/wizardStore';
import {
  getBox,
  createUser,
  ensureUser,
  createModel,
  saveTeamConfig,
  saveDeployConfig,
  saveRepoConfig,
} from '../services/api';

const STEPS = ['用户配置', '模型配置', '团队配置', '部署配置', 'Git配置'];

const NAV_ITEMS = [
  { icon: 'settings', label: '账号配置', path: '/wizard/user-setup' },
  { icon: 'dashboard', label: '账号概览', path: '/wizard/overview' },
  { icon: 'agent', label: '数字员工', path: '/agent-creator' },
];

const stepPaths = [
  '/wizard/user-setup',
  '/wizard/model-config',
  '/wizard/team-config',
  '/wizard/deploy-config',
  '/wizard/repo-config',
];

// Map wizard modelId to backend provider + model_name
const MODEL_MAP: Record<string, { provider: string; model_name: string }> = {
  'opus4.6': { provider: 'anthropic', model_name: 'claude-opus-4-6' },
  'sonnet4.6': { provider: 'anthropic', model_name: 'claude-sonnet-4-6' },
  'gemini3flash': { provider: 'google', model_name: 'gemini-3-flash' },
  'gpt53codex': { provider: 'openai', model_name: 'gpt-5.3-codex' },
};

const WizardLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    currentStep, setCurrentStep,
    stepValid, showValidationErrors, setShowValidationErrors,
    snackbar, hideSnackbar, showSnackbar,
    userSetup, modelConfig, teamConfig, deployConfig, repoConfig,
    wizardUserId, setWizardUserId,
  } = useWizardStore();
  const [saving, setSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [boxName, setBoxName] = useState<string | null>(null);
  const [boxHost, setBoxHost] = useState<string | null>(null);
  const boxId = useWizardStore((s) => s.auth.boxId);

  useEffect(() => {
    if (boxId) {
      getBox(boxId)
        .then((box) => {
          setBoxName(box.name);
          setBoxHost(`${box.host}:${box.port}`);
        })
        .catch(() => { /* ignore */ });
    }
  }, [boxId]);

  // Sync URL with store step on location change
  React.useEffect(() => {
    const stepIndex = stepPaths.indexOf(location.pathname);
    if (stepIndex >= 0 && stepIndex !== currentStep) {
      setCurrentStep(stepIndex);
    }
  }, [location.pathname, currentStep, setCurrentStep]);

  const activeItem = location.pathname;
  const isOverview = location.pathname === '/wizard/overview';

  const handleNavClick = (path: string) => {
    if (path === '/wizard/user-setup') {
      setCurrentStep(0);
    }
    navigate(path);
  };

  const handleStepClick = (step: number) => {
    setShowValidationErrors(false);
    setCurrentStep(step);
    navigate(stepPaths[step]);
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setShowValidationErrors(false);
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      navigate(stepPaths[prevStep]);
    }
  };

  const handleNext = async () => {
    if (!stepValid) {
      setShowValidationErrors(true);
      return;
    }
    setShowValidationErrors(false);

    // Step 0 (UserSetup) → create or verify user before proceeding
    if (currentStep === 0) {
      setSaving(true);
      try {
        const user = await ensureUser({
          username: userSetup.username,
          password: userSetup.password,
          role: 'programmer',
        });
        setWizardUserId(Number(user.id));
        showSnackbar('用户就绪，继续配置模型');
      } catch (e) {
        const msg = e instanceof Error ? e.message : '操作失败';
        showSnackbar(msg);
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStep < STEPS.length - 1) {
      const nextStepIndex = currentStep + 1;
      setCurrentStep(nextStepIndex);
      navigate(stepPaths[nextStepIndex]);
    }
  };

  const handleComplete = async () => {
    if (!stepValid) {
      setShowValidationErrors(true);
      return;
    }
    setShowValidationErrors(false);
    setSaving(true);

    const errors: string[] = [];

    // 1. User already created/verified in step 0 → step 1 transition
    // If wizardUserId is null (shouldn't happen), try to create now as fallback
    let targetUserId = wizardUserId;
    if (!targetUserId) {
      try {
        const user = await ensureUser({
          username: userSetup.username,
          password: userSetup.password,
          role: 'programmer',
        });
        targetUserId = Number(user.id);
        setWizardUserId(targetUserId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        errors.push(`用户: ${msg}`);
      }
    }

    // 2. Save models (pass is_verified directly for atomic creation)
    // Collect DB model IDs for use in team config
    const modelIdMap = new Map<string, number>();
    try {
      for (const model of modelConfig.models) {
        const mapping = MODEL_MAP[model.modelId];
        if (!mapping) continue;
        const result = await createModel({
          provider: mapping.provider,
          model_name: mapping.model_name,
          api_key: model.activationToken || undefined,
          is_verified: model.verified,
          user_id: targetUserId ?? undefined,
        });
        modelIdMap.set(model.modelId, result.id);
      }
    } catch (e) {
      errors.push(`模型: ${e instanceof Error ? e.message : '保存失败'}`);
    }

    // 3. Save team config (with model ID assignments)
    try {
      const roleModelIds: Record<string, number | undefined> = {};
      for (const agent of teamConfig.agents) {
        if (agent.assignedModel && modelIdMap.has(agent.assignedModel)) {
          roleModelIds[agent.role] = modelIdMap.get(agent.assignedModel);
        }
      }

      await saveTeamConfig({
        config_name: teamConfig.configName || 'default',
        user_id: targetUserId ?? undefined,
        architect_model_id: roleModelIds['architect'] ?? null,
        frontend_model_id: roleModelIds['frontend'] ?? null,
        backend_model_id: roleModelIds['backend'] ?? null,
        reviewer_model_id: roleModelIds['reviewer'] ?? null,
        devops_model_id: roleModelIds['devops'] ?? null,
        agents: teamConfig.agents.map((a) => ({
          role: a.role,
          count: a.count,
          superpowersPrompt: a.superpowersPrompt,
        })),
      });
    } catch (e) {
      errors.push(`团队: ${e instanceof Error ? e.message : '保存失败'}`);
    }

    // 4. Save deploy config (include git info for deploy.yaml generation)
    try {
      if (deployConfig.deployType === 'cloud') {
        await saveDeployConfig({
          deployType: 'cloud',
          serverIp: deployConfig.serverIp,
          port: deployConfig.port,
          aliAccount: deployConfig.aliAccount,
          aliPassword: deployConfig.aliPassword,
          user_id: targetUserId ?? undefined,
          gitRepoUrl: repoConfig.repoUrl || undefined,
          gitBranch: repoConfig.selectedBranch || undefined,
          gitToken: repoConfig.accessToken || undefined,
        });
      } else {
        await saveDeployConfig({
          deployType: 'local',
          user_id: targetUserId ?? undefined,
          gitRepoUrl: repoConfig.repoUrl || undefined,
          gitBranch: repoConfig.selectedBranch || undefined,
          gitToken: repoConfig.accessToken || undefined,
        });
      }
    } catch (e) {
      errors.push(`部署: ${e instanceof Error ? e.message : '保存失败'}`);
    }

    // 5. Save repo config (only if repoUrl is set)
    if (repoConfig.repoUrl) {
      try {
        await saveRepoConfig({
          platform: repoConfig.platform,
          repoUrl: repoConfig.repoUrl,
          authMethod: 'token',
          credential: repoConfig.accessToken,
          user_id: targetUserId ?? undefined,
          is_verified: repoConfig.connectionTested,
        });
      } catch (e) {
        errors.push(`仓库: ${e instanceof Error ? e.message : '保存失败'}`);
      }
    }

    setSaving(false);

    if (errors.length > 0) {
      showSnackbar(`部分保存失败: ${errors.join('; ')}`);
    } else {
      showSnackbar('所有配置已保存');
    }
    navigate('/wizard/overview');
  };

  return (
    <div className="flex h-screen bg-surface font-roboto">
      {/* Left: Navigation Drawer (fixed 256px) */}
      <NavigationDrawer
        items={NAV_ITEMS}
        activeItem={activeItem}
        onItemClick={handleNavClick}
        header={
          <div className="flex items-start justify-between">
            <div>
              {boxName ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
                      <path d="M20 7l-8-4-8 4v10l8 4 8-4V7zm-8-1.8L17.6 8 12 10.8 6.4 8 12 5.2zM5 9.24l6 3v6.52l-6-3V9.24zm8 9.52v-6.52l6-3v6.52l-6 3z" fill="currentColor"/>
                    </svg>
                  </div>
                  <div>
                    <h1 className="title-medium text-on-surface leading-tight">{boxName}</h1>
                    <p className="label-small text-on-surface-variant">配置向导</p>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="title-large text-on-surface">AgentTeam</h1>
                  <p className="body-small text-on-surface-variant mt-1">配置向导</p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="p-1.5 rounded-full text-on-surface-variant hover:bg-on-surface/[0.08] transition-colors"
              title="退出登录"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        }
      />

      {/* Right: Stepper + Content + Footer */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top: Stepper (hidden on overview) */}
        {!isOverview && (
          <div className="border-b border-outline-variant bg-surface px-6 py-2">
            <Stepper
              steps={STEPS}
              activeStep={currentStep}
              onStepClick={handleStepClick}
            />
          </div>
        )}

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>

        {/* Bottom: Action Bar (hidden on overview) */}
        {!isOverview && (
          <div className="border-t border-outline-variant bg-surface px-8 py-4 flex justify-between items-center">
            <Button
              variant="text"
              onClick={handlePrev}
              disabled={currentStep === 0 || saving}
              icon={<ArrowLeftIcon size={18} />}
            >
              上一步
            </Button>

            <span className="body-medium text-on-surface-variant">
              第 {currentStep + 1} 步，共 {STEPS.length} 步
            </span>

            {currentStep === STEPS.length - 1 ? (
              <Button
                variant={stepValid ? 'filled' : 'tonal'}
                onClick={handleComplete}
                disabled={saving}
                icon={<ArrowRightIcon size={18} />}
                className={!stepValid && !saving ? 'opacity-60' : ''}
              >
                {saving ? '保存中...' : '完成'}
              </Button>
            ) : (
              <Button
                variant={stepValid ? 'filled' : 'tonal'}
                onClick={handleNext}
                icon={<ArrowRightIcon size={18} />}
                className={!stepValid ? 'opacity-60' : ''}
              >
                下一步
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Logout Confirm Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40">
          <Card variant="elevated" className="w-full max-w-xs mx-4 text-center">
            <h3 className="title-large text-on-surface mb-2">退出登录</h3>
            <p className="body-medium text-on-surface-variant mb-6">确定要退出当前账号吗？</p>
            <div className="flex justify-end gap-3">
              <Button variant="text" onClick={() => setShowLogoutConfirm(false)}>
                取消
              </Button>
              <Button variant="filled" onClick={() => { setShowLogoutConfirm(false); localStorage.removeItem('jwt_token'); navigate('/login'); }}>
                确定退出
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Global Snackbar */}
      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={hideSnackbar}
      />
    </div>
  );
};

export default WizardLayout;
