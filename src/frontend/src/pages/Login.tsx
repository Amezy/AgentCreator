/**
 * @module Login
 * @description 登录页面 - 系统的入口。
 * 管理员通过用户名和密码登录后，根据角色跳转到不同页面：
 * 管理员进入配置向导，程序员角色则禁止登录 Box 管理系统。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/m3/Card';
import TextField from '../components/m3/TextField';
import Button from '../components/m3/Button';
import Snackbar from '../components/m3/Snackbar';
import useWizardStore from '../store/wizardStore';
import { login } from '../services/api';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth } = useWizardStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!username.trim()) newErrors.username = '请输入用户名';
    if (!password) newErrors.password = '请输入密码';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      const response = await login(username, password);
      const { id, username: uname, role, box_id: boxId } = response.user;
      setAuth({ token: response.token, isAuthenticated: true, userId: Number(id), username: uname, role, boxId });

      // Role-based redirect for box-system
      if (role === 'admin' || role === 'super_admin') {
        navigate('/wizard/user-setup');
      } else if (role === 'programmer') {
        setSnackbar({ open: true, message: '程序员角色无法登录 Box 管理系统' });
      } else {
        navigate('/wizard/overview');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败，请重试';
      setSnackbar({ open: true, message });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface font-roboto p-4">
      <div className="w-full max-w-sm" onKeyDown={handleKeyDown}>
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary-container mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-on-primary-container">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/>
            </svg>
          </div>
          <h1 className="headline-medium text-on-surface">AgentTeam</h1>
          <p className="body-medium text-on-surface-variant mt-1">
            登录以继续配置
          </p>
        </div>

        <Card variant="elevated" className="space-y-5">
          <TextField
            label="用户名"
            value={username}
            onChange={(value) => {
              setUsername(value);
              if (errors.username) setErrors((prev) => ({ ...prev, username: '' }));
            }}
            error={errors.username}
            helperText="默认管理员: aiboxadmin"
          />

          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              if (errors.password) setErrors((prev) => ({ ...prev, password: '' }));
            }}
            error={errors.password}
            helperText="Linux 系统密码 (默认: changeme123)"
          />

          <Button
            variant="filled"
            onClick={handleLogin}
            disabled={loading}
            className="w-full"
          >
            {loading ? '登录中...' : '登录'}
          </Button>
        </Card>
      </div>

      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default Login;
