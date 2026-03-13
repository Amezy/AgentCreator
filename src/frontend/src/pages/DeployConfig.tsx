/**
 * @module DeployConfig
 * @description 部署配置页面 - 配置向导的第四步。
 * 支持本地部署和云端部署两种模式。本地部署无需额外配置，
 * 云端部署需要填写服务器 IP、端口、服务器账号和密码。
 */
import React, { useEffect } from 'react';
import Card from '../components/m3/Card';
import TextField from '../components/m3/TextField';
import useWizardStore from '../store/wizardStore';

const DeployConfig: React.FC = () => {
  const { deployConfig, setDeployConfig, setStepValid, showValidationErrors, stepValid } = useWizardStore();

  const isCloud = deployConfig.deployType === 'cloud';

  // Local: always valid. Cloud: all fields required.
  useEffect(() => {
    if (!isCloud) {
      setStepValid(true);
    } else {
      const valid = !!(
        deployConfig.serverIp.trim() &&
        deployConfig.port.trim() &&
        deployConfig.aliAccount.trim() &&
        deployConfig.aliPassword.trim()
      );
      setStepValid(valid);
    }
  }, [deployConfig, isCloud, setStepValid]);

  useEffect(() => {
    return () => setStepValid(false);
  }, [setStepValid]);

  const missingFields = showValidationErrors && !stepValid;

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="headline-small text-on-surface mb-2">部署配置</h2>
      <p className="body-medium text-on-surface-variant mb-6">
        选择部署方式，本地部署无需额外配置，云端部署需填写服务器信息。
      </p>

      {/* Deploy type toggle */}
      <div className="flex rounded-xl border border-outline-variant overflow-hidden mb-4">
        <button
          type="button"
          onClick={() => setDeployConfig({ deployType: 'local' })}
          className={`flex-1 px-4 py-3 label-large transition-colors ${
            !isCloud
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
        >
          本地部署
        </button>
        <button
          type="button"
          onClick={() => setDeployConfig({ deployType: 'cloud' })}
          className={`flex-1 px-4 py-3 label-large transition-colors ${
            isCloud
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
        >
          云端部署
        </button>
      </div>

      {!isCloud ? (
        <Card variant="elevated">
          <div className="flex items-center gap-3 mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-primary flex-shrink-0">
              <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" fill="currentColor"/>
            </svg>
            <h3 className="title-medium text-on-surface">本地部署</h3>
          </div>
          <p className="body-medium text-on-surface-variant">
            使用本地环境运行，无需额外配置。系统将在当前机器上启动所有服务。
          </p>
          <div className="mt-4 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
            <p className="body-small text-primary">可直接进入下一步。</p>
          </div>
        </Card>
      ) : (
        <>
          {missingFields && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-error/5 border border-error/30">
              <p className="body-medium text-error">请填写所有云端部署信息。</p>
            </div>
          )}

          <Card variant="elevated" className={`transition-all duration-300 ${missingFields ? '!border-error border-2' : ''}`}>
            <h3 className="title-medium text-on-surface mb-4">云端部署</h3>
            <div className="space-y-4">
              <TextField
                label="IP 地址"
                value={deployConfig.serverIp}
                onChange={(value) => setDeployConfig({ serverIp: value })}
                error={missingFields && !deployConfig.serverIp.trim() ? '必填' : undefined}
              />
              <TextField
                label="端口号"
                value={deployConfig.port}
                onChange={(value) => setDeployConfig({ port: value })}
                error={missingFields && !deployConfig.port.trim() ? '必填' : undefined}
              />
              <TextField
                label="服务器账号"
                value={deployConfig.aliAccount}
                onChange={(value) => setDeployConfig({ aliAccount: value })}
                error={missingFields && !deployConfig.aliAccount.trim() ? '必填' : undefined}
              />
              <TextField
                label="服务器密码"
                type="password"
                value={deployConfig.aliPassword}
                onChange={(value) => setDeployConfig({ aliPassword: value })}
                error={missingFields && !deployConfig.aliPassword.trim() ? '必填' : undefined}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default DeployConfig;
