/**
 * @module RepoConfig
 * @description Git 仓库配置页面 - 配置向导的第五步（最后一步）。
 * 支持 GitHub 和 GitLab 平台，通过 HTTPS + 私人令牌连接代码仓库。
 * 可验证仓库连通性并展示仓库的分支和标签信息，也可跳过此步骤。
 */
import React, { useState, useEffect } from 'react';
import Card from '../components/m3/Card';
import TextField from '../components/m3/TextField';
import Button from '../components/m3/Button';
import Snackbar from '../components/m3/Snackbar';
import { CheckIcon } from '../components/icons/Icons';
import useWizardStore from '../store/wizardStore';
import { gitLsRemote } from '../services/api';
import type { GitRef } from '../services/api';

const TOKEN_HELP_URLS: Record<string, { label: string; hint: string }> = {
  github: {
    label: 'GitHub Personal Access Token',
    hint: '前往 GitHub → Settings → Developer settings → Personal access tokens → 生成令牌，需要 repo 权限。',
  },
  gitlab: {
    label: '私人令牌 (Personal Access Token)',
    hint: '前往代码平台 → 个人中心 → 个人令牌 → 新建私人令牌，权限勾选 Git http clone 和 Git http push。',
  },
};

const RepoConfig: React.FC = () => {
  const { repoConfig, setRepoConfig, setStepValid, showValidationErrors, stepValid } = useWizardStore();
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [skipGit, setSkipGit] = useState(false);

  useEffect(() => {
    return () => setStepValid(false);
  }, [setStepValid]);

  useEffect(() => {
    setStepValid(skipGit || repoConfig.connectionTested);
  }, [repoConfig.connectionTested, skipGit, setStepValid]);

  const isGithub = repoConfig.platform === 'github';
  const helpInfo = TOKEN_HELP_URLS[repoConfig.platform] || TOKEN_HELP_URLS.gitlab;

  const handlePlatformChange = (platform: 'github' | 'gitlab') => {
    setRepoConfig({ platform, repoUrl: '', accessToken: '', connectionTested: false, selectedBranch: '' });
    setRefs([]);
  };

  const handleTokenChange = (value: string) => {
    setRepoConfig({ accessToken: value, connectionTested: false, selectedBranch: '' });
    setRefs([]);
  };

  const handleRepoUrlChange = (value: string) => {
    setRepoConfig({ repoUrl: value, connectionTested: false, selectedBranch: '' });
    setRefs([]);
  };

  const handleConnectRepo = async () => {
    if (!repoConfig.repoUrl.trim()) {
      setSnackbar({ open: true, message: '请输入仓库地址' });
      return;
    }
    if (!repoConfig.accessToken.trim()) {
      setSnackbar({ open: true, message: '请输入访问令牌' });
      return;
    }

    setLoadingRefs(true);
    try {
      const result = await gitLsRemote(repoConfig.repoUrl, repoConfig.accessToken);
      if (result.error) {
        setRefs([]);
        setRepoConfig({ connectionTested: false });
        setSnackbar({ open: true, message: result.error });
      } else {
        setRefs(result.refs);
        // Auto-select the first branch as default
        const firstBranch = result.refs.find((r) => r.type === 'branch');
        setRepoConfig({ connectionTested: true, selectedBranch: firstBranch?.name || '' });
        setSnackbar({
          open: true,
          message: result.count > 0
            ? `仓库连接成功，发现 ${result.count} 个引用`
            : '仓库为空（新建仓库），连接成功',
        });
      }
    } catch (err) {
      setRefs([]);
      setRepoConfig({ connectionTested: false });
      setSnackbar({ open: true, message: err instanceof Error ? err.message : '仓库连接失败' });
    } finally {
      setLoadingRefs(false);
    }
  };

  const handleSkipToggle = () => {
    setSkipGit(!skipGit);
    if (!skipGit) {
      setRepoConfig({ repoUrl: '', accessToken: '', connectionTested: false, selectedBranch: '' });
      setRefs([]);
    }
  };

  const branches = refs.filter((r) => r.type === 'branch');
  const tags = refs.filter((r) => r.type === 'tag');

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="headline-small text-on-surface mb-2">Git 仓库配置</h2>
      <p className="body-medium text-on-surface-variant mb-6">
        通过 HTTPS + 私人令牌连接代码仓库，实现安全的代码推拉。
      </p>

      {/* Skip option */}
      <button
        type="button"
        onClick={handleSkipToggle}
        className={`w-full mb-4 px-4 py-3 rounded-xl border transition-all duration-200 flex items-center gap-3 ${
          skipGit
            ? 'border-primary bg-primary/5'
            : 'border-outline-variant hover:bg-surface-container'
        }`}
      >
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          skipGit ? 'border-primary bg-primary' : 'border-outline'
        }`}>
          {skipGit && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="white"/>
            </svg>
          )}
        </div>
        <div className="text-left">
          <span className={`label-large block ${skipGit ? 'text-primary' : 'text-on-surface'}`}>暂不配置 Git 仓库</span>
          <span className="body-small text-on-surface-variant">可稍后在账号概览中配置</span>
        </div>
      </button>

      {skipGit ? (
        <Card variant="elevated">
          <div className="flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-primary flex-shrink-0">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"/>
            </svg>
            <p className="body-medium text-on-surface-variant">
              已跳过 Git 配置，可直接点击"完成"。
            </p>
          </div>
        </Card>
      ) : (
        <>
          {showValidationErrors && !stepValid && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-error/5 border border-error/30">
              <p className="body-medium text-error">
                {!repoConfig.accessToken ? '请先输入私人令牌。' :
                 !repoConfig.repoUrl ? '请输入仓库地址。' :
                 '请连接仓库以完成验证。'}
              </p>
            </div>
          )}

          {/* Platform Selector */}
          <div className="flex rounded-xl border border-outline-variant overflow-hidden mb-4">
            <button
              type="button"
              onClick={() => handlePlatformChange('github')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 label-large transition-colors ${
                isGithub ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              GitHub
            </button>
            <button
              type="button"
              onClick={() => handlePlatformChange('gitlab')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 label-large transition-colors ${
                !isGithub ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
              </svg>
              GitLab（私有云）
            </button>
          </div>

          {/* Card 1: Personal Access Token */}
          <Card variant="elevated" className="space-y-4 mb-4">
            <p className="title-small text-on-surface">第一步：填入私人令牌</p>
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-secondary-container/40">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-on-secondary-container flex-shrink-0 mt-0.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"/>
              </svg>
              <p className="body-small text-on-secondary-container">
                {helpInfo.hint}
              </p>
            </div>
            <TextField
              label={helpInfo.label}
              value={repoConfig.accessToken}
              onChange={handleTokenChange}
              helperText="令牌仅用于本地 git 操作，不会上传到其他服务器"
            />
          </Card>

          {/* Card 2: Repo URL */}
          <Card variant="elevated" className="space-y-4 mb-4">
            <p className="title-small text-on-surface">第二步：输入仓库地址并验证</p>
            <p className="body-small text-on-surface-variant">
              输入仓库的 HTTPS 克隆地址，例如：
              <code className="font-mono text-xs bg-surface-variant/30 px-1 py-0.5 rounded ml-1">
                {isGithub
                  ? 'https://github.com/user/project.git'
                  : 'https://code.iflytek.com/group/project.git'}
              </code>
            </p>
            <TextField
              label="仓库 HTTPS 地址"
              value={repoConfig.repoUrl}
              onChange={handleRepoUrlChange}
              helperText="从仓库页面复制 HTTPS 克隆地址"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="filled"
                onClick={handleConnectRepo}
                disabled={loadingRefs || !repoConfig.repoUrl.trim() || !repoConfig.accessToken.trim()}
                className="whitespace-nowrap"
              >
                {loadingRefs ? '连接中...' : '验证连接'}
              </Button>
              {repoConfig.connectionTested && (
                <span className="flex items-center gap-1 text-primary body-medium">
                  <CheckIcon size={18} className="text-primary" />
                  连接成功
                </span>
              )}
            </div>
          </Card>

          {/* Card 3: Refs display */}
          {repoConfig.connectionTested && (
            <Card variant="elevated" className="space-y-4">
              {refs.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-secondary-container/40">
                  <CheckIcon size={18} className="text-primary" />
                  <span className="body-small text-on-secondary-container">空仓库，连接成功。代码将在部署时推送。</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="title-small text-on-surface">仓库内容</span>
                    <span className="label-small text-on-surface-variant">
                      {branches.length} 分支 · {tags.length} 标签
                    </span>
                  </div>
                  <div className="rounded-xl border border-outline-variant overflow-hidden max-h-[240px] overflow-y-auto">
                    {branches.length > 0 && (
                      <div>
                        <div className="px-4 py-2 bg-surface-container-highest label-medium text-on-surface-variant sticky top-0">分支</div>
                        {branches.map((b) => {
                          const isSelected = repoConfig.selectedBranch === b.name;
                          return (
                            <button
                              key={b.ref}
                              type="button"
                              onClick={() => setRepoConfig({ selectedBranch: b.name })}
                              className={`w-full flex items-center gap-3 px-4 py-2 border-t border-outline-variant text-left transition-colors ${
                                isSelected ? 'bg-primary/10' : 'hover:bg-surface-container'
                              }`}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-primary flex-shrink-0">
                                <path d="M6 3v6c0 .55.45 1 1 1h4l-5 7V11H4l5-7v1c0-.55-.45-1-1-1H6zm12 18v-6c0-.55-.45-1-1-1h-4l5-7v6h2l-5 7v-1c0 .55.45 1 1 1h2z" fill="currentColor"/>
                              </svg>
                              <span className={`body-medium flex-1 ${isSelected ? 'text-primary font-medium' : 'text-on-surface'}`}>{b.name}</span>
                              {isSelected && (
                                <CheckIcon size={16} className="text-primary flex-shrink-0" />
                              )}
                              <code className="label-small text-on-surface-variant font-mono">{b.hash}</code>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {tags.length > 0 && (
                      <div>
                        <div className="px-4 py-2 bg-surface-container-highest label-medium text-on-surface-variant sticky top-0">标签</div>
                        {tags.map((t) => (
                          <div key={t.ref} className="flex items-center gap-3 px-4 py-2 border-t border-outline-variant">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-tertiary flex-shrink-0">
                              <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" fill="currentColor"/>
                            </svg>
                            <span className="body-medium text-on-surface flex-1">{t.name}</span>
                            <code className="label-small text-on-surface-variant font-mono">{t.hash}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </Card>
          )}
        </>
      )}

      <Snackbar message={snackbar.message} open={snackbar.open} onClose={() => setSnackbar({ open: false, message: '' })} />
    </div>
  );
};

export default RepoConfig;
