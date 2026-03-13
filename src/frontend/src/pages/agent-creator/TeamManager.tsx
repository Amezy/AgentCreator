/**
 * @module TeamManager
 * @description 团队管理页面 - 组建数字员工团队，支持模板快速创建、角色管理和员工分配。
 */
import React, { useState, useEffect, useCallback } from 'react';
import Button from '../../components/m3/Button';
import Snackbar from '../../components/m3/Snackbar';
import { teamApi, personaApi } from '../../services/agentCreatorApi';

// ===== 常量 =====

const LEVEL_CONFIG: Record<string, { label: string; color: string }> = {
  junior: { label: '初级', color: 'bg-primary-container text-on-primary-container' },
  mid: { label: '中级', color: 'bg-secondary-container text-on-secondary-container' },
  senior: { label: '高级', color: 'bg-tertiary-container text-on-tertiary-container' },
  expert: { label: '专家', color: 'bg-error-container text-on-error-container' },
};

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-on-surface-variant',
  busy: 'bg-primary',
  offline: 'bg-error',
  error: 'bg-tertiary',
};

// ===== 确认删除弹窗 =====

const ConfirmDialog: React.FC<{
  open: boolean; message: string; onConfirm: () => void; onCancel: () => void;
}> = ({ open, message, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/50" onClick={onCancel} />
      <div className="relative bg-surface-container-high rounded-xl shadow-elevation-3 p-6 max-w-sm mx-4">
        <p className="body-large text-on-surface mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="text" onClick={onCancel}>取消</Button>
          <Button variant="filled" onClick={onConfirm}>确认删除</Button>
        </div>
      </div>
    </div>
  );
};

// ===== 通用 Modal =====

const Modal: React.FC<{
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
  maxWidth?: string;
}> = ({ open, title, onClose, children, maxWidth = 'max-w-lg' }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/50" onClick={onClose} />
      <div className={`relative bg-surface-container-high rounded-xl shadow-elevation-3 p-6 mx-4 w-full ${maxWidth} max-h-[85vh] overflow-y-auto`}>
        <h3 className="title-large text-on-surface mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
};

// ===== 创建团队 Modal =====

const CreateTeamModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  showSnackbar: (msg: string) => void;
}> = ({ open, onClose, onCreated, showSnackbar }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState<{ role_name: string; required_level: string }[]>([
    { role_name: '', required_level: 'mid' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const handleAddRole = () => {
    setRoles([...roles, { role_name: '', required_level: 'mid' }]);
  };

  const handleRemoveRole = (idx: number) => {
    setRoles(roles.filter((_, i) => i !== idx));
  };

  const handleRoleChange = (idx: number, field: string, value: string) => {
    const updated = [...roles];
    (updated[idx] as any)[field] = value;
    setRoles(updated);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      showSnackbar('请输入团队名称');
      return;
    }
    const validRoles = roles.filter(r => r.role_name.trim());
    setSubmitting(true);
    try {
      await teamApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        roles: validRoles.map((r, i) => ({ ...r, sort_order: i })),
      });
      showSnackbar('团队创建成功');
      onCreated();
      onClose();
      setName('');
      setDescription('');
      setRoles([{ role_name: '', required_level: 'mid' }]);
    } catch (err: any) {
      showSnackbar(err.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title="创建自定义团队" onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className="block body-small text-on-surface-variant mb-1 ml-1">团队名称 *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="输入团队名称"
            className="w-full px-4 py-3 bg-transparent border border-outline rounded-xs text-on-surface body-large outline-none focus:border-primary focus:border-2 transition-colors"
          />
        </div>
        <div>
          <label className="block body-small text-on-surface-variant mb-1 ml-1">描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="团队描述（可选）"
            rows={2}
            className="w-full px-4 py-3 bg-transparent border border-outline rounded-xs text-on-surface body-large outline-none focus:border-primary focus:border-2 transition-colors resize-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="body-small text-on-surface-variant ml-1">角色列表</label>
            <button
              type="button"
              onClick={handleAddRole}
              className="label-small text-primary hover:text-primary/80"
            >
              + 添加角色
            </button>
          </div>
          <div className="space-y-2">
            {roles.map((role, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={role.role_name}
                  onChange={e => handleRoleChange(idx, 'role_name', e.target.value)}
                  placeholder="角色名称"
                  className="flex-1 px-3 py-2 bg-transparent border border-outline rounded-xs text-on-surface body-medium outline-none focus:border-primary focus:border-2 transition-colors"
                />
                <select
                  value={role.required_level}
                  onChange={e => handleRoleChange(idx, 'required_level', e.target.value)}
                  className="px-3 py-2 bg-transparent border border-outline rounded-xs text-on-surface body-medium outline-none focus:border-primary focus:border-2 transition-colors"
                >
                  <option value="junior">初级</option>
                  <option value="mid">中级</option>
                  <option value="senior">高级</option>
                  <option value="expert">专家</option>
                </select>
                {roles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRole(idx)}
                    className="p-1.5 rounded-full hover:bg-error/[0.08] text-error"
                    title="移除"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button variant="filled" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '创建中...' : '创建团队'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ===== 团队详情 Modal =====

const TeamDetailModal: React.FC<{
  open: boolean;
  teamId: string | null;
  onClose: () => void;
  onChanged: () => void;
  showSnackbar: (msg: string) => void;
}> = ({ open, teamId, onClose, onChanged, showSnackbar }) => {
  const [team, setTeam] = useState<any>(null);
  const [personas, setPersonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleLevel, setNewRoleLevel] = useState('mid');
  const [showAddRole, setShowAddRole] = useState(false);

  const fetchTeam = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      const data = await teamApi.get(teamId);
      setTeam(data);
    } catch {
      setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const fetchPersonas = useCallback(async () => {
    try {
      const data = await personaApi.list();
      setPersonas(data || []);
    } catch {
      setPersonas([]);
    }
  }, []);

  useEffect(() => {
    if (open && teamId) {
      fetchTeam();
      fetchPersonas();
    }
  }, [open, teamId, fetchTeam, fetchPersonas]);

  const handleAssign = async (roleId: string, personaId: string) => {
    try {
      await teamApi.assignPersona(roleId, personaId);
      showSnackbar('员工已分配');
      fetchTeam();
      onChanged();
    } catch (err: any) {
      showSnackbar(err.message || '分配失败');
    }
    setAssigningRole(null);
  };

  const handleUnassign = async (roleId: string) => {
    try {
      await teamApi.unassignPersona(roleId);
      showSnackbar('已取消分配');
      fetchTeam();
      onChanged();
    } catch (err: any) {
      showSnackbar(err.message || '操作失败');
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    try {
      await teamApi.removeRole(roleId);
      showSnackbar('角色已移除');
      fetchTeam();
      onChanged();
    } catch (err: any) {
      showSnackbar(err.message || '移除失败');
    }
  };

  const handleAddRole = async () => {
    if (!newRoleName.trim() || !teamId) return;
    try {
      await teamApi.addRole(teamId, {
        role_name: newRoleName.trim(),
        required_level: newRoleLevel,
      });
      showSnackbar('角色已添加');
      setNewRoleName('');
      setNewRoleLevel('mid');
      setShowAddRole(false);
      fetchTeam();
      onChanged();
    } catch (err: any) {
      showSnackbar(err.message || '添加失败');
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} title={team?.name || '团队详情'} onClose={onClose} maxWidth="max-w-2xl">
      {loading ? (
        <p className="body-medium text-on-surface-variant py-8 text-center">加载中...</p>
      ) : !team ? (
        <p className="body-medium text-on-surface-variant py-8 text-center">团队未找到</p>
      ) : (
        <div className="space-y-4">
          {/* Team info */}
          {team.description && (
            <p className="body-medium text-on-surface-variant">{team.description}</p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-block px-2.5 py-1 rounded-full label-small ${team.is_active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'}`}>
              {team.is_active ? '活跃' : '已停用'}
            </span>
            {team.template_key && (
              <span className="inline-block px-2.5 py-1 rounded-full label-small bg-secondary-container text-on-secondary-container">
                {team.template_key === 'dev_team' ? '开发模板' : team.template_key === 'consulting_team' ? '咨询模板' : team.template_key}
              </span>
            )}
            <span className="body-small text-on-surface-variant">
              {team.filled_count}/{team.role_count} 已填充
            </span>
          </div>

          {/* Roles table */}
          <div className="border border-outline-variant rounded-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-container">
                  <th className="text-left px-4 py-2.5 label-medium text-on-surface-variant">角色</th>
                  <th className="text-left px-4 py-2.5 label-medium text-on-surface-variant">等级要求</th>
                  <th className="text-left px-4 py-2.5 label-medium text-on-surface-variant">分配员工</th>
                  <th className="text-right px-4 py-2.5 label-medium text-on-surface-variant">操作</th>
                </tr>
              </thead>
              <tbody>
                {(team.roles || []).map((role: any) => {
                  const levelCfg = LEVEL_CONFIG[role.required_level] || { label: role.required_level || '-', color: 'bg-surface-container-highest text-on-surface-variant' };
                  const isAssigning = assigningRole === role.id;
                  return (
                    <tr key={role.id} className="border-t border-outline-variant">
                      <td className="px-4 py-3">
                        <span className="body-medium text-on-surface">{role.role_name}</span>
                        {role.position_name && (
                          <span className="body-small text-on-surface-variant ml-2">({role.position_name})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full label-small ${levelCfg.color}`}>
                          {levelCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isAssigning ? (
                          <select
                            className="px-2 py-1 bg-transparent border border-outline rounded-xs text-on-surface body-small outline-none focus:border-primary"
                            autoFocus
                            defaultValue=""
                            onChange={e => {
                              if (e.target.value) handleAssign(role.id, e.target.value);
                              else setAssigningRole(null);
                            }}
                            onBlur={() => setAssigningRole(null)}
                          >
                            <option value="">选择员工...</option>
                            {personas.map((p: any) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({LEVEL_CONFIG[p.level]?.label || p.level})
                              </option>
                            ))}
                          </select>
                        ) : role.persona_id ? (
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[role.persona_status] || 'bg-on-surface-variant'}`} />
                            <span className="body-medium text-on-surface">{role.persona_name}</span>
                          </div>
                        ) : (
                          <span className="body-small text-on-surface-variant/60 italic">空缺</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {role.persona_id ? (
                            <button
                              type="button"
                              className="px-2 py-1 rounded label-small text-on-surface-variant hover:bg-on-surface/[0.08]"
                              onClick={() => handleUnassign(role.id)}
                              title="取消分配"
                            >
                              取消分配
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="px-2 py-1 rounded label-small text-primary hover:bg-primary/[0.08]"
                              onClick={() => setAssigningRole(role.id)}
                              title="分配员工"
                            >
                              分配
                            </button>
                          )}
                          <button
                            type="button"
                            className="p-1.5 rounded-full hover:bg-error/[0.08] text-error"
                            onClick={() => handleRemoveRole(role.id)}
                            title="移除角色"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(team.roles || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center body-medium text-on-surface-variant">
                      暂无角色
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Add role */}
          {showAddRole ? (
            <div className="flex items-center gap-2">
              <input
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder="角色名称"
                className="flex-1 px-3 py-2 bg-transparent border border-outline rounded-xs text-on-surface body-medium outline-none focus:border-primary focus:border-2 transition-colors"
                autoFocus
              />
              <select
                value={newRoleLevel}
                onChange={e => setNewRoleLevel(e.target.value)}
                className="px-3 py-2 bg-transparent border border-outline rounded-xs text-on-surface body-medium outline-none focus:border-primary focus:border-2 transition-colors"
              >
                <option value="junior">初级</option>
                <option value="mid">中级</option>
                <option value="senior">高级</option>
                <option value="expert">专家</option>
              </select>
              <Button variant="tonal" onClick={handleAddRole}>添加</Button>
              <Button variant="text" onClick={() => { setShowAddRole(false); setNewRoleName(''); }}>取消</Button>
            </div>
          ) : (
            <Button variant="text" onClick={() => setShowAddRole(true)}>
              + 添加角色
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
};

// ===== 主组件 =====

const TeamManager: React.FC = () => {
  const [teams, setTeams] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [detailTeamId, setDetailTeamId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [templateCreating, setTemplateCreating] = useState<string | null>(null);

  const showSnackbar = (message: string) => setSnackbar({ open: true, message });

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teamApi.list();
      setTeams(data || []);
    } catch {
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await teamApi.getStats();
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => { fetchTeams(); fetchStats(); }, [fetchTeams, fetchStats]);

  const handleRefresh = () => { fetchTeams(); fetchStats(); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await teamApi.delete(deleteTarget.id);
      showSnackbar('团队已删除');
      handleRefresh();
    } catch (err: any) {
      showSnackbar(err.message || '删除失败');
    }
    setDeleteTarget(null);
  };

  const handleTemplateCreate = async (templateKey: string, templateName: string) => {
    setTemplateCreating(templateKey);
    try {
      await teamApi.createFromTemplate({
        template_key: templateKey,
        name: templateName,
      });
      showSnackbar(`${templateName}创建成功`);
      handleRefresh();
    } catch (err: any) {
      showSnackbar(err.message || '创建失败');
    } finally {
      setTemplateCreating(null);
    }
  };

  const handleToggleActive = async (team: any) => {
    try {
      if (team.is_active) {
        await teamApi.deactivate(team.id);
        showSnackbar('团队已停用');
      } else {
        await teamApi.activate(team.id);
        showSnackbar('团队已激活');
      }
      handleRefresh();
    } catch (err: any) {
      showSnackbar(err.message || '操作失败');
    }
  };

  return (
    <div className="h-full flex flex-col font-roboto">
      {/* 页面标题 + 创建按钮 */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="title-large text-on-surface">团队管理</h2>
          <p className="body-medium text-on-surface-variant mt-1">
            组建数字员工团队，定义协作模式和任务分配规则
          </p>
        </div>
        <Button
          variant="filled"
          onClick={() => setCreateModalOpen(true)}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          }
        >
          创建团队
        </Button>
      </div>

      {/* 统计栏 */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-4 py-2">
          <span className="body-medium text-on-surface-variant">团队总数</span>
          <span className="title-medium text-on-surface">{stats?.total_teams ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="body-small text-on-surface-variant">活跃 {stats?.active_teams ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-on-surface-variant">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
          <span className="body-small text-on-surface-variant">总角色 {stats?.total_roles ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-on-surface-variant" />
          <span className="body-small text-on-surface-variant">已填充 {stats?.filled_roles ?? 0}</span>
        </div>
      </div>

      {/* 模板快速创建 */}
      <div className="mb-4">
        <p className="label-medium text-on-surface-variant mb-2 ml-1">快速创建</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 开发团队模板 */}
          <button
            type="button"
            className="text-left bg-surface-container-low border border-outline-variant rounded-md p-4 hover:shadow-elevation-1 transition-shadow disabled:opacity-60"
            onClick={() => handleTemplateCreate('dev_team', '软件开发团队')}
            disabled={templateCreating === 'dev_team'}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-on-primary-container">
                  <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="title-small text-on-surface">软件开发团队</p>
                <p className="body-small text-on-surface-variant truncate">
                  架构师 + 2名开发 + 测试 + 产品（5个角色）
                </p>
              </div>
            </div>
          </button>

          {/* 咨询团队模板 */}
          <button
            type="button"
            className="text-left bg-surface-container-low border border-outline-variant rounded-md p-4 hover:shadow-elevation-1 transition-shadow disabled:opacity-60"
            onClick={() => handleTemplateCreate('consulting_team', '咨询团队')}
            disabled={templateCreating === 'consulting_team'}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-on-tertiary-container">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="title-small text-on-surface">咨询团队</p>
                <p className="body-small text-on-surface-variant truncate">
                  咨询经理 + 2名行业分析师（3个角色）
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 团队列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="bg-surface-container rounded-lg p-12 text-center">
            <p className="body-medium text-on-surface-variant">加载中...</p>
          </div>
        ) : teams.length === 0 ? (
          <div className="bg-surface border border-outline-variant rounded-md p-6 text-center py-12">
            <div className="w-16 h-16 rounded-full bg-secondary-container/30 flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-secondary/60">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/>
              </svg>
            </div>
            <p className="title-medium text-on-surface mb-1">暂无团队</p>
            <p className="body-medium text-on-surface-variant mb-4">
              使用上方模板快速创建团队，或点击"创建团队"自定义
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {teams.map((team: any) => (
              <div
                key={team.id}
                className="bg-surface-container-low rounded-md p-4 border border-outline-variant hover:shadow-elevation-1 transition-shadow cursor-pointer"
                onClick={() => setDetailTeamId(team.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="title-small text-on-surface truncate">{team.name}</h3>
                      <span className={`inline-block px-2 py-0.5 rounded-full label-small shrink-0 ${team.is_active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                        {team.is_active ? '活跃' : '停用'}
                      </span>
                    </div>
                    {team.description && (
                      <p className="body-small text-on-surface-variant mt-0.5 truncate">{team.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="label-small bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded-full">
                        {team.filled_count}/{team.role_count} 角色
                      </span>
                      {team.template_key && (
                        <span className="label-small text-on-surface-variant">
                          {team.template_key === 'dev_team' ? '开发' : team.template_key === 'consulting_team' ? '咨询' : '自定义'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-0.5 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="p-2 rounded-full hover:bg-on-surface/[0.08] text-on-surface-variant"
                      title={team.is_active ? '停用' : '激活'}
                      onClick={() => handleToggleActive(team)}
                    >
                      {team.is_active ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="p-2 rounded-full hover:bg-error/[0.08] text-error"
                      title="删除"
                      onClick={() => setDeleteTarget(team)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Progress bar for fill rate */}
                {team.role_count > 0 && (
                  <div className="mt-3">
                    <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.round((team.filled_count / team.role_count) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 创建团队弹窗 */}
      <CreateTeamModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleRefresh}
        showSnackbar={showSnackbar}
      />

      {/* 团队详情弹窗 */}
      <TeamDetailModal
        open={!!detailTeamId}
        teamId={detailTeamId}
        onClose={() => setDetailTeamId(null)}
        onChanged={handleRefresh}
        showSnackbar={showSnackbar}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        message={`确定要删除团队「${deleteTarget?.name}」吗？此操作会同时删除所有角色配置。`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar({ open: false, message: '' })}
      />
    </div>
  );
};

export default TeamManager;
