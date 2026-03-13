/**
 * @module Overview
 * @description 账号概览页面 - 以用户为中心的管理面板。
 * 展示所有用户及其关联的配置（模型、团队、部署、仓库、VS Code、Claude 认证、SSH 密钥），
 * 支持对各项配置的 CRUD 操作，并通过弹窗进行编辑。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/m3/Button';
import TextField from '../components/m3/TextField';
import NumberStepper from '../components/m3/NumberStepper';
import Snackbar from '../components/m3/Snackbar';
import { CheckIcon } from '../components/icons/Icons';
import useWizardStore from '../store/wizardStore';
import {
  getUsers, createUser, updateUser, deleteUser,
  getModels,
  getTeams, createTeam, updateTeam, deleteTeam,
  getDeploys, saveDeployConfig, updateDeploy, deleteDeploy,
  getRepos, saveRepoConfig, updateRepo, deleteRepo,
  getVscodeStatus, checkClaudeAuth, getSshKeys,
} from '../services/api';
import type { UserListItem, TeamListItem } from '../services/api';
import { Modal, Seg, getModelLabel } from './overview/shared';
import type { UserConfigData } from './overview/types';
import UserCard from './overview/UserCard';

// ── Main Overview Component ──

const Overview: React.FC = () => {
  const navigate = useNavigate();
  const resetWizard = useWizardStore((s) => s.resetWizard);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const toast = useCallback((message: string) => setSnackbar({ open: true, message }), []);

  // ── Data ──
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userDataMap, setUserDataMap] = useState<Record<number, UserConfigData>>({});

  // ── Dirty tracking ──
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialDataRef = useRef<string>('');

  // ── Expanded user ──
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  // ── Modals ──
  const [userModal, setUserModal] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'programmer' });

  const [teamModal, setTeamModal] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [teamFormTouched, setTeamFormTouched] = useState(false);
  const [teamForm, setTeamForm] = useState({
    config_name: '',
    frontend_count: '1',
    backend_count: '1',
    architect_model_id: null as number | null,
    frontend_model_id: null as number | null,
    backend_model_id: null as number | null,
    reviewer_model_id: null as number | null,
    devops_model_id: null as number | null,
  });

  const [deployModal, setDeployModal] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [deployForm, setDeployForm] = useState({ deployType: 'cloud', serverIp: '', port: '22', username: '', password: '' });

  const [repoModal, setRepoModal] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [repoForm, setRepoForm] = useState({ platform: 'github', repoUrl: '', authMethod: 'ssh_key', credential: '' });

  // ── Load users list ──
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const u = await getUsers();
      setUsers(u);
      initialDataRef.current = JSON.stringify(u);
      setIsDirty(false);
    } catch (e) { toast(e instanceof Error ? e.message : '加载失败'); }
    setLoading(false);
  }, [toast]);

  // Load config data for a specific user (including new endpoints)
  const loadUserData = useCallback(async (userId: number) => {
    try {
      const [m, t, d, r, vs, ca, sk] = await Promise.all([
        getModels(userId),
        getTeams(userId),
        getDeploys(userId),
        getRepos(userId),
        getVscodeStatus(userId).catch(() => null),
        checkClaudeAuth(userId).catch(() => null),
        getSshKeys(userId).catch(() => []),
      ]);
      setUserDataMap((prev) => ({
        ...prev,
        [userId]: { models: m, teams: t, deploys: d, repos: r, vscodeStatus: vs, claudeAuth: ca, sshKeys: sk, loaded: true },
      }));
    } catch (e) { toast(e instanceof Error ? e.message : '加载用户配置失败'); }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => {
    if (expandedUser !== null) {
      loadUserData(expandedUser);
    }
  }, [expandedUser, loadUserData]);

  const reloadCurrentUser = useCallback(async () => {
    await loadUsers();
    if (expandedUser !== null) {
      await loadUserData(expandedUser);
    }
  }, [loadUsers, loadUserData, expandedUser]);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await reloadCurrentUser();
      toast('所有配置已保存');
    } catch (e) { toast(e instanceof Error ? e.message : '保存失败'); }
    setSaving(false);
  };

  // ── CRUD Handlers ──

  const handleUserSave = async () => {
    try {
      if (userModal.editId) {
        const p: Record<string, string> = {};
        if (userForm.username) p.username = userForm.username;
        if (userForm.password) p.password = userForm.password;
        await updateUser(userModal.editId, p);
        toast('用户已更新');
      } else {
        await createUser({ username: userForm.username, password: userForm.password, role: 'programmer' });
        toast('用户已创建');
      }
      setUserModal({ open: false, editId: null }); reloadCurrentUser();
    } catch (e) { toast(e instanceof Error ? e.message : '操作失败'); }
  };

  const allRoleModelsSelected = teamForm.architect_model_id !== null
    && teamForm.frontend_model_id !== null
    && teamForm.backend_model_id !== null
    && teamForm.reviewer_model_id !== null
    && teamForm.devops_model_id !== null;

  const handleTeamSave = async () => {
    setTeamFormTouched(true);
    if (!teamForm.config_name || !allRoleModelsSelected) return;
    try {
      const data = {
        config_name: teamForm.config_name,
        frontend_count: parseInt(teamForm.frontend_count),
        backend_count: parseInt(teamForm.backend_count),
        architect_model_id: teamForm.architect_model_id,
        frontend_model_id: teamForm.frontend_model_id,
        backend_model_id: teamForm.backend_model_id,
        reviewer_model_id: teamForm.reviewer_model_id,
        devops_model_id: teamForm.devops_model_id,
      };
      if (teamModal.editId) { await updateTeam(teamModal.editId, data); }
      else { await createTeam(data); }
      toast(teamModal.editId ? '团队已更新' : '团队已创建');
      setTeamFormTouched(false);
      setTeamModal({ open: false, editId: null }); reloadCurrentUser();
    } catch (e) { toast(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleDeploySave = async () => {
    try {
      if (deployModal.editId) {
        await updateDeploy(deployModal.editId, { deployType: deployForm.deployType, serverIp: deployForm.serverIp, port: deployForm.port, username: deployForm.username, password: deployForm.password });
      } else {
        await saveDeployConfig({ deployType: deployForm.deployType, serverIp: deployForm.serverIp, port: deployForm.port, aliAccount: deployForm.username, aliPassword: deployForm.password });
      }
      toast(deployModal.editId ? '部署已更新' : '部署已创建');
      setDeployModal({ open: false, editId: null }); reloadCurrentUser();
    } catch (e) { toast(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleRepoSave = async () => {
    try {
      if (repoModal.editId) {
        await updateRepo(repoModal.editId, { platform: repoForm.platform, repoUrl: repoForm.repoUrl, authMethod: repoForm.authMethod, credential: repoForm.credential });
      } else {
        await saveRepoConfig({ platform: repoForm.platform, repoUrl: repoForm.repoUrl, authMethod: repoForm.authMethod, credential: repoForm.credential });
      }
      toast(repoModal.editId ? '仓库已更新' : '仓库已创建');
      setRepoModal({ open: false, editId: null }); reloadCurrentUser();
    } catch (e) { toast(e instanceof Error ? e.message : '操作失败'); }
  };

  const confirmDelete = async (label: string, fn: () => Promise<void>) => {
    if (!confirm(`确认删除该${label}？`)) return;
    try { await fn(); toast(`${label}已删除`); reloadCurrentUser(); } catch (e) { toast(e instanceof Error ? e.message : '删除失败'); }
  };

  // ── Team modal helper ──
  const openTeamModal = (team: TeamListItem | null) => {
    setTeamFormTouched(false);
    if (team) {
      setTeamForm({ config_name: team.config_name, frontend_count: String(team.frontend_count), backend_count: String(team.backend_count), architect_model_id: team.architect_model_id, frontend_model_id: team.frontend_model_id, backend_model_id: team.backend_model_id, reviewer_model_id: team.reviewer_model_id, devops_model_id: team.devops_model_id });
      setTeamModal({ open: true, editId: team.id });
    } else {
      setTeamForm({ config_name: '', frontend_count: '1', backend_count: '1', architect_model_id: null, frontend_model_id: null, backend_model_id: null, reviewer_model_id: null, devops_model_id: null });
      setTeamModal({ open: true, editId: null });
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="body-large text-on-surface-variant">加载中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="headline-small text-on-surface mb-1">账号概览</h2>
          <p className="body-medium text-on-surface-variant">以用户为中心管理所有配置</p>
        </div>
        <div className="flex gap-2">
          <Button variant="text" onClick={() => { setUserDataMap({}); loadUsers(); }}>刷新</Button>
          <Button variant="filled" onClick={handleSaveAll} disabled={!isDirty && !saving}>
            {saving ? '保存中...' : '保存修改'}
          </Button>
        </div>
      </div>

      {/* User List */}
      {users.map((user) => (
        <UserCard
          key={user.id}
          user={user}
          isExpanded={expandedUser === user.id}
          onToggle={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
          userData={userDataMap[user.id]}
          onEditUser={() => { setUserForm({ username: user.username, password: '', role: user.role }); setUserModal({ open: true, editId: user.id }); }}
          onDeleteUser={async () => {
            if (!confirm('确认删除该用户？')) return;
            const doDelete = async (force: boolean) => {
              await deleteUser(user.id, force);
              toast(force ? '用户已强制删除' : '用户已删除');
              setExpandedUser(null);
              setUserDataMap((prev) => { const next = { ...prev }; delete next[user.id]; return next; });
              const freshUsers = await getUsers();
              setUsers(freshUsers);
            };
            try {
              await doDelete(false);
            } catch (e) {
              const msg = e instanceof Error ? e.message : '删除失败';
              if (msg.includes('当前在线')) {
                if (confirm(`${msg}\n\n是否强制断开连接并删除？`)) {
                  try { await doDelete(true); } catch (e2) { toast(e2 instanceof Error ? e2.message : '强制删除失败'); }
                }
              } else {
                toast(msg);
              }
            }
          }}
          onEditTeam={(t) => openTeamModal(t)}
          onDeleteTeam={(id) => confirmDelete('团队', () => deleteTeam(id))}
          onAddTeam={() => openTeamModal(null)}
          onEditDeploy={(d) => { setDeployForm({ deployType: d.deploy_type || 'cloud', serverIp: d.cloud_host || '', port: String(d.cloud_port || 22), username: d.cloud_user || '', password: '' }); setDeployModal({ open: true, editId: d.id }); }}
          onDeleteDeploy={(id) => confirmDelete('部署配置', () => deleteDeploy(id))}
          onAddDeploy={() => { setDeployForm({ deployType: 'cloud', serverIp: '', port: '22', username: '', password: '' }); setDeployModal({ open: true, editId: null }); }}
          onEditRepo={(r) => { setRepoForm({ platform: r.platform, repoUrl: r.remote_url, authMethod: r.auth_type, credential: '' }); setRepoModal({ open: true, editId: r.id }); }}
          onDeleteRepo={(id) => confirmDelete('仓库', () => deleteRepo(id))}
          onAddRepo={() => { setRepoForm({ platform: 'github', repoUrl: '', authMethod: 'ssh_key', credential: '' }); setRepoModal({ open: true, editId: null }); }}
          onReload={reloadCurrentUser}
          toast={toast}
        />
      ))}

      {/* Add user button */}
      <div className="flex justify-center">
        <Button variant="tonal" onClick={() => { resetWizard(); navigate('/wizard/user-setup'); }}>
          + 新建用户
        </Button>
      </div>

      {/* ── Modals ── */}

      <Modal open={userModal.open} title={userModal.editId ? '编辑用户' : '新建用户'} onClose={() => setUserModal({ open: false, editId: null })} onConfirm={handleUserSave} confirmDisabled={!userForm.username || (!userModal.editId && !userForm.password)}>
        <div className="space-y-4">
          <TextField label="用户名" value={userForm.username} onChange={(v) => setUserForm((f) => ({ ...f, username: v }))} />
          <TextField label={userModal.editId ? '新密码（留空不修改）' : '密码'} type="password" value={userForm.password} onChange={(v) => setUserForm((f) => ({ ...f, password: v }))} />
          <div className="flex items-center gap-3">
            <span className="label-medium text-on-surface-variant">角色</span>
            <span className="label-medium px-3 py-1.5 rounded-xl bg-primary text-on-primary">开发者</span>
          </div>
        </div>
      </Modal>

      <Modal open={teamModal.open} title={teamModal.editId ? '编辑团队' : '新建团队'} onClose={() => { setTeamFormTouched(false); setTeamModal({ open: false, editId: null }); }} onConfirm={handleTeamSave}>
        <div className="space-y-4">
          <TextField label="配置名称" value={teamForm.config_name} onChange={(v) => setTeamForm((f) => ({ ...f, config_name: v }))} />
          {(() => {
            const userModels = expandedUser !== null ? (userDataMap[expandedUser]?.models || []) : [];
            const verifiedModels = userModels.filter((m) => m.is_verified === 1);
            const roleModelFieldMap: Record<string, keyof typeof teamForm> = {
              architect: 'architect_model_id',
              frontend: 'frontend_model_id',
              backend: 'backend_model_id',
              reviewer: 'reviewer_model_id',
              devops: 'devops_model_id',
            };
            return (
              <div className="space-y-2 pt-2">
                <p className="label-medium text-on-surface-variant">团队角色 & 模型绑定</p>
                {[
                  { key: 'architect', label: '架构师', fixed: true, count: 1, min: 1, max: 1 },
                  { key: 'frontend', label: '前端开发', fixed: true, count: 1, min: 1, max: 1 },
                  { key: 'backend', label: '后端开发', fixed: true, count: 1, min: 1, max: 1 },
                  { key: 'reviewer', label: '代码审查', fixed: true, count: 1, min: 1, max: 1 },
                  { key: 'devops', label: 'DevOps', fixed: true, count: 1, min: 1, max: 1 },
                ].map((role) => {
                  const modelField = roleModelFieldMap[role.key];
                  const selectedModelId = teamForm[modelField] as number | null;
                  const isMissing = teamFormTouched && selectedModelId === null && verifiedModels.length > 0;
                  return (
                    <div key={role.key} className={`py-2 px-3 rounded-lg space-y-1.5 ${isMissing ? 'bg-error/5 ring-1 ring-error' : 'bg-surface-container/50'}`}>
                      <div className="flex items-center justify-between">
                        <span className="body-medium text-on-surface">{role.label}</span>
                        {role.fixed ? (
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-surface-container-highest label-large text-on-surface-variant">{role.count}</span>
                        ) : (
                          <NumberStepper value={role.count} min={role.min} max={role.max} onChange={(v) => setTeamForm((f) => ({ ...f, [role.key === 'frontend' ? 'frontend_count' : 'backend_count']: String(v) }))} />
                        )}
                      </div>
                      {verifiedModels.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {verifiedModels.map((m) => {
                            const isSelected = selectedModelId === m.id;
                            return (
                              <button key={m.id} type="button" onClick={() => setTeamForm((f) => ({ ...f, [modelField]: isSelected ? null : m.id }))} className={`flex items-center gap-1 px-2 py-1 rounded-md label-small transition-all duration-200 ${isSelected ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}>
                                {isSelected && <CheckIcon size={12} />}
                                {getModelLabel(m.model_name)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {verifiedModels.length === 0 && (
                  <p className="body-small text-on-surface-variant/60 px-3">该用户暂无已验证的模型</p>
                )}
                {teamFormTouched && !allRoleModelsSelected && verifiedModels.length > 0 && (
                  <p className="body-small text-error px-3">请为每个角色选择模型</p>
                )}
              </div>
            );
          })()}
        </div>
      </Modal>

      <Modal open={deployModal.open} title={deployModal.editId ? '编辑部署' : '新建部署'} onClose={() => setDeployModal({ open: false, editId: null })} onConfirm={handleDeploySave}>
        <div className="space-y-4">
          <TextField label="服务器 IP" value={deployForm.serverIp} onChange={(v) => setDeployForm((f) => ({ ...f, serverIp: v }))} />
          <TextField label="端口" value={deployForm.port} onChange={(v) => setDeployForm((f) => ({ ...f, port: v }))} />
          <TextField label="用户名" value={deployForm.username} onChange={(v) => setDeployForm((f) => ({ ...f, username: v }))} />
          <TextField label="密码" type="password" value={deployForm.password} onChange={(v) => setDeployForm((f) => ({ ...f, password: v }))} />
        </div>
      </Modal>

      <Modal open={repoModal.open} title={repoModal.editId ? '编辑仓库' : '关联仓库'} onClose={() => setRepoModal({ open: false, editId: null })} onConfirm={handleRepoSave} confirmDisabled={!repoForm.repoUrl}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="label-medium text-on-surface-variant whitespace-nowrap">平台</span>
            <Seg options={[{ k: 'github', l: 'GitHub' }, { k: 'gitlab', l: 'GitLab' }, { k: 'gitee', l: 'Gitee' }]} value={repoForm.platform} onChange={(v) => setRepoForm((f) => ({ ...f, platform: v }))} />
          </div>
          <TextField label="仓库地址" value={repoForm.repoUrl} onChange={(v) => setRepoForm((f) => ({ ...f, repoUrl: v }))} />
          <div className="flex items-center gap-3">
            <span className="label-medium text-on-surface-variant whitespace-nowrap">认证</span>
            <Seg options={[{ k: 'ssh_key', l: 'SSH' }, { k: 'token', l: 'Token' }]} value={repoForm.authMethod} onChange={(v) => setRepoForm((f) => ({ ...f, authMethod: v }))} />
          </div>
          <TextField label="凭证" value={repoForm.credential} onChange={(v) => setRepoForm((f) => ({ ...f, credential: v }))} />
        </div>
      </Modal>

      <Snackbar message={snackbar.message} open={snackbar.open} onClose={() => setSnackbar({ open: false, message: '' })} />
    </div>
  );
};

export default Overview;
