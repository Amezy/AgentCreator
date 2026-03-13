/**
 * @module UserSetup
 * @description 用户配置页面 - 配置向导的第一步。
 * 用于创建程序员账户，包含用户名和密码的输入与校验。
 * 校验通过后允许向导进入下一步。
 */
import React, { useEffect, useState } from 'react';
import Card from '../components/m3/Card';
import TextField from '../components/m3/TextField';
import useWizardStore from '../store/wizardStore';

const UserSetup: React.FC = () => {
  const { userSetup, setUserSetup, setStepValid } = useWizardStore();
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // --- Validation ---
  const usernameError =
    touched.username && !userSetup.username.trim()
      ? '请输入用户名'
      : touched.username && userSetup.username.trim().length < 3
      ? '用户名至少 3 个字符'
      : '';

  const passwordError =
    touched.password && !userSetup.password
      ? '请输入密码'
      : touched.password && userSetup.password.length < 6
      ? '密码至少 6 个字符'
      : '';

  const isValid =
    userSetup.username.trim().length >= 3 && userSetup.password.length >= 6;

  useEffect(() => {
    setStepValid(isValid);
  }, [isValid, setStepValid]);

  useEffect(() => {
    return () => setStepValid(false);
  }, [setStepValid]);

  const handleUsernameChange = (value: string) => {
    setUserSetup({ username: value });
    if (!touched.username) setTouched((prev) => ({ ...prev, username: true }));
  };

  const handlePasswordChange = (value: string) => {
    setUserSetup({ password: value });
    if (!touched.password) setTouched((prev) => ({ ...prev, password: true }));
  };

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="headline-small text-on-surface mb-2">用户配置</h2>
      <p className="body-medium text-on-surface-variant mb-6">
        创建程序员账户以使用 AgentTeam 服务。
      </p>

      <Card variant="elevated" className="space-y-6">
        <TextField
          label="用户名"
          value={userSetup.username}
          onChange={handleUsernameChange}
          error={usernameError}
          helperText="至少 3 个字符"
        />

        <TextField
          label="密码"
          type="password"
          value={userSetup.password}
          onChange={handlePasswordChange}
          error={passwordError}
          helperText="至少 6 个字符"
        />
      </Card>
    </div>
  );
};

export default UserSetup;
