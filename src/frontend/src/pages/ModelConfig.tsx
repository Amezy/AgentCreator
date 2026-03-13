/**
 * @module ModelConfig
 * @description 模型配置页面 - 配置向导的第二步。
 * 支持选择多个 AI 模型提供商（Anthropic、Google、OpenAI），
 * 通过 OAuth PKCE 或 API Key 方式完成模型激活验证。
 * 验证通过的模型可在后续步骤中分配给团队角色。
 */
import React, { useState, useCallback, useEffect } from 'react';
import Card from '../components/m3/Card';
import TextField from '../components/m3/TextField';
import Button from '../components/m3/Button';
import Snackbar from '../components/m3/Snackbar';
import { CopyIcon, CheckIcon } from '../components/icons/Icons';
import useWizardStore from '../store/wizardStore';
import {
  startClaudeAuth,
  submitClaudeCode,
} from '../services/api';

// ── Provider & Model Definitions ──

interface ModelDef {
  value: string;
  label: string;
}

interface ProviderDef {
  id: string;
  label: string;
  models: ModelDef[];
  disabled?: boolean;
  needsOAuth?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    needsOAuth: true,
    models: [
      { value: 'opus4.6', label: 'Opus 4.6' },
      { value: 'sonnet4.6', label: 'Sonnet 4.6' },
    ],
  },
  {
    id: 'google',
    label: 'Google',
    models: [
      { value: 'gemini3flash', label: 'Gemini3 Flash' },
      { value: 'gemini31pro', label: 'Gemini3.1 Pro' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    disabled: true,
    models: [
      { value: 'gpt53codex', label: 'GPT-5.3 Codex' },
    ],
  },
];

const ModelConfig: React.FC = () => {
  const { modelConfig, toggleModel, updateModelEntry, setStepValid, showValidationErrors, wizardUserId } = useWizardStore();
  const [fetchingAuth, setFetchingAuth] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  // Track session IDs per provider for OAuth PKCE
  const [sessionIds, setSessionIds] = useState<Record<string, string>>({});

  const selectedModels = modelConfig.models;

  // Valid when at least one model is verified
  useEffect(() => {
    const hasVerified = selectedModels.some((m) => m.verified);
    setStepValid(hasVerified);
  }, [selectedModels, setStepValid]);

  useEffect(() => {
    return () => setStepValid(false);
  }, [setStepValid]);

  // ── Provider helpers ──

  const isProviderSelected = (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return false;
    return provider.models.some((m) => selectedModels.some((sm) => sm.modelId === m.value));
  };

  const isProviderVerified = (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return false;
    const providerModels = provider.models.filter((m) => selectedModels.some((sm) => sm.modelId === m.value));
    return providerModels.length > 0 && providerModels.every((m) => selectedModels.find((sm) => sm.modelId === m.value)?.verified);
  };

  const getProviderFirstModel = (providerId: string) => {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return null;
    return selectedModels.find((sm) => provider.models.some((m) => m.value === sm.modelId)) || null;
  };

  const handleToggleProvider = (provider: ProviderDef) => {
    if (isProviderSelected(provider.id)) {
      provider.models.forEach((m) => {
        if (selectedModels.some((sm) => sm.modelId === m.value)) {
          toggleModel(m.value, m.label);
        }
      });
    } else {
      provider.models.forEach((m) => {
        if (!selectedModels.some((sm) => sm.modelId === m.value)) {
          toggleModel(m.value, m.label);
        }
      });
    }
  };

  // ── Auth & Activation ──

  const handleCopyAuth = useCallback(async (id: string, authString: string) => {
    try {
      await navigator.clipboard.writeText(authString);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = authString;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleFetchAuth = async (provider: ProviderDef) => {
    const firstModel = getProviderFirstModel(provider.id);
    if (!firstModel || !wizardUserId) return;

    setFetchingAuth(provider.id);
    try {
      if (provider.needsOAuth) {
        // Real OAuth PKCE: call backend to start session
        const res = await startClaudeAuth(wizardUserId);
        setSessionIds((prev) => ({ ...prev, [provider.id]: res.sessionId }));
        updateModelEntry(firstModel.modelId, {
          authString: res.oauthUrl,
          activationToken: '',
          verified: false,
        });
        setSnackbar({ open: true, message: `${provider.label} 认证链接已生成，请复制到浏览器完成授权。` });
      } else {
        // Non-OAuth providers: placeholder for API key flow
        updateModelEntry(firstModel.modelId, {
          authString: '',
          activationToken: '',
          verified: false,
        });
        setSnackbar({ open: true, message: `${provider.label}: 请输入 API Key 进行验证。` });
      }
    } catch (err) {
      setSnackbar({ open: true, message: `获取认证串失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setFetchingAuth(null);
    }
  };

  const handleActivate = async (provider: ProviderDef, token: string) => {
    if (!token.trim() || !wizardUserId) {
      setSnackbar({ open: true, message: '请输入激活 Token' });
      return;
    }

    setActivating(provider.id);
    try {
      if (provider.needsOAuth) {
        // Real OAuth PKCE: submit authorization code to backend
        const sid = sessionIds[provider.id];
        if (!sid) {
          setSnackbar({ open: true, message: '请先获取认证串' });
          setActivating(null);
          return;
        }
        const res = await submitClaudeCode(wizardUserId, token.trim(), sid);
        if (res.success) {
          provider.models.forEach((m) => {
            if (selectedModels.some((sm) => sm.modelId === m.value)) {
              updateModelEntry(m.value, { verified: true });
            }
          });
          setSnackbar({ open: true, message: `${provider.label} 激活成功` });
        } else {
          setSnackbar({ open: true, message: `激活失败: ${res.error || '未知错误'}` });
        }
      } else {
        // Non-OAuth: API key verification placeholder
        provider.models.forEach((m) => {
          if (selectedModels.some((sm) => sm.modelId === m.value)) {
            updateModelEntry(m.value, { verified: true });
          }
        });
        setSnackbar({ open: true, message: `${provider.label} 激活成功` });
      }
    } catch (err) {
      setSnackbar({ open: true, message: `激活失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActivating(null);
    }
  };

  const verifiedCount = selectedModels.filter((m) => m.verified).length;
  const needsAttention = showValidationErrors && verifiedCount === 0;
  const selectedProviders = PROVIDERS.filter((p) => isProviderSelected(p.id));

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="headline-small text-on-surface mb-2">模型配置</h2>
      <p className="body-medium text-on-surface-variant mb-6">
        选择 AI 模型提供商并完成激活。选择提供商后将自动包含其所有可用模型，验证通过后可分配给团队角色。
      </p>

      {/* Provider Selection */}
      <Card variant="elevated" className={`space-y-4 mb-4 transition-all duration-300 ${needsAttention ? '!border-error border-2 shadow-error/20' : ''}`}>
        <p className={`body-medium ${needsAttention ? 'text-error font-medium' : 'text-on-surface-variant'}`}>
          {needsAttention ? '请选择并验证至少一个提供商' : '选择提供商（可多选）'}
        </p>
        <div className="space-y-3">
          {PROVIDERS.map((provider) => {
            const selected = isProviderSelected(provider.id);
            const verified = isProviderVerified(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                disabled={provider.disabled}
                onClick={() => handleToggleProvider(provider)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 text-left ${
                  provider.disabled
                    ? 'border-outline/30 text-on-surface/30 cursor-not-allowed'
                    : selected
                    ? 'border-primary bg-primary/10'
                    : needsAttention
                    ? 'border-error/40 bg-error/5 hover:bg-error/10 animate-pulse'
                    : 'border-outline-variant hover:bg-surface-container'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  selected
                    ? verified ? 'bg-primary' : 'bg-outline'
                    : 'border-2 border-outline-variant'
                }`}>
                  {selected && <CheckIcon size={14} className={verified ? 'text-on-primary' : 'text-surface'} />}
                </span>
                <div className="flex-1">
                  <span className={`title-small ${provider.disabled ? '' : selected ? 'text-primary' : needsAttention ? 'text-error' : 'text-on-surface'}`}>
                    {provider.label}
                  </span>
                  <p className="body-small text-on-surface-variant">
                    {provider.models.map((m) => m.label).join('、')}
                  </p>
                </div>
                {selected && (
                  <span className={`label-small px-2 py-0.5 rounded-full ${verified ? 'bg-primary/10 text-primary' : 'bg-outline/10 text-on-surface-variant'}`}>
                    {verified ? '已验证' : '待验证'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {selectedModels.length > 0 && (
          <p className="body-small text-on-surface-variant">
            已选 {selectedModels.length} 个模型（{selectedProviders.length} 个提供商），{verifiedCount} 个已验证
          </p>
        )}
        <p className="body-small text-on-surface-variant">灰色选项表示当前硬件版本暂不支持。</p>
      </Card>

      {/* Per-provider activation cards */}
      {selectedProviders.map((provider) => {
        const verified = isProviderVerified(provider.id);
        const firstModel = getProviderFirstModel(provider.id);
        if (!firstModel) return null;

        return (
          <Card key={provider.id} variant="elevated" className={`space-y-5 mb-4 transition-all duration-300 ${showValidationErrors && !verified ? '!border-error border-2' : ''}`}>
            <div className="flex items-center gap-3">
              <h3 className="title-medium text-on-surface flex-1">{provider.label}</h3>
              <p className="body-small text-on-surface-variant">
                {provider.models.map((m) => m.label).join('、')}
              </p>
              {verified ? (
                <span className="flex items-center gap-1 label-medium text-primary">
                  <CheckIcon size={16} className="text-primary" /> 已激活
                </span>
              ) : (
                <span className="label-medium text-on-surface-variant">未激活</span>
              )}
            </div>

            {!verified && (
              <>
                {/* Step 1: Auth String / OAuth URL */}
                <div>
                  <p className="body-medium text-on-surface mb-3">
                    第一步：{provider.needsOAuth ? '获取认证串' : '输入 API Key'}
                  </p>
                  {provider.needsOAuth ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-outline bg-surface-variant/30 min-h-[48px] flex-1">
                        {firstModel.authString ? (
                          <>
                            <span className="body-medium text-on-surface flex-1 break-all select-all">
                              {firstModel.authString}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyAuth(provider.id, firstModel.authString)}
                              className="flex-shrink-0 p-2 rounded-full hover:bg-on-surface/[0.08] transition-colors"
                              title={copiedId === provider.id ? '已复制' : '复制认证串'}
                            >
                              {copiedId === provider.id ? (
                                <CheckIcon size={20} className="text-primary" />
                              ) : (
                                <CopyIcon size={20} className="text-on-surface-variant" />
                              )}
                            </button>
                          </>
                        ) : (
                          <span className="body-medium text-on-surface-variant flex-1">点击右侧按钮获取认证串</span>
                        )}
                      </div>
                      <Button
                        variant="tonal"
                        onClick={() => handleFetchAuth(provider)}
                        disabled={fetchingAuth === provider.id}
                        className="flex-shrink-0 whitespace-nowrap"
                      >
                        {fetchingAuth === provider.id ? '获取中...' : '获取认证串'}
                      </Button>
                    </div>
                  ) : (
                    <TextField
                      label="API Key"
                      value={firstModel.activationToken}
                      onChange={(value) => updateModelEntry(firstModel.modelId, { activationToken: value, verified: false })}
                      helperText="请输入提供商的 API Key"
                    />
                  )}
                  {provider.needsOAuth && firstModel.authString && (
                    <p className="body-small text-on-surface-variant mt-1">
                      请复制上方链接到浏览器完成 OAuth 授权，然后将页面显示的授权码粘贴到下方。
                    </p>
                  )}
                </div>

                {/* Step 2: Submit authorization code (OAuth only) */}
                {provider.needsOAuth && (
                  <div>
                    <p className="body-medium text-on-surface mb-3">第二步：输入授权码</p>
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <TextField
                          label="授权码"
                          value={firstModel.activationToken}
                          onChange={(value) => updateModelEntry(firstModel.modelId, { activationToken: value, verified: false })}
                          helperText="请粘贴浏览器 OAuth 回调页面中显示的授权码 (code#state 格式)"
                        />
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 mt-1">
                        <Button
                          variant="filled"
                          onClick={() => handleActivate(provider, firstModel.activationToken)}
                          disabled={activating === provider.id || !firstModel.activationToken.trim()}
                          className="whitespace-nowrap"
                        >
                          {activating === provider.id ? '激活中...' : '激活'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Non-OAuth: single-step API key verification */}
                {!provider.needsOAuth && (
                  <div className="flex justify-end">
                    <Button
                      variant="filled"
                      onClick={() => handleActivate(provider, firstModel.activationToken)}
                      disabled={activating === provider.id || !firstModel.activationToken.trim()}
                    >
                      {activating === provider.id ? '验证中...' : '验证'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}

      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default ModelConfig;
