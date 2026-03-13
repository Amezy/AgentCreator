/**
 * @module SshKeySection
 * @description SSH 密钥管理子区块组件。
 * 展示用户的 SSH 公钥列表（指纹、类型、备注、创建时间），
 * 支持删除已有密钥和添加新密钥的操作。
 */
import React from 'react';
import { SubSection, icons } from './shared';
import type { SshKeyItem } from '../../services/api';
import { deleteSshKey } from '../../services/api';
import Button from '../../components/m3/Button';

interface Props {
  userId: number;
  sshKeys: SshKeyItem[];
  onAdd: () => void;
  onReload: () => void;
  toast: (msg: string) => void;
}

const SshKeySection: React.FC<Props> = ({ userId, sshKeys, onAdd, onReload, toast }) => {
  const handleDelete = async (keyId: number) => {
    if (!confirm('确认删除该 SSH 密钥？')) return;
    try {
      await deleteSshKey(userId, keyId);
      toast('SSH 密钥已删除');
      onReload();
    } catch (err) {
      toast(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <SubSection
      icon={icons.sshKey}
      title="SSH 密钥"
      badge={`${sshKeys.length} 个`}
    >
      <div className="px-4 py-3 space-y-3">
        {sshKeys.length === 0 ? (
          <p className="body-medium text-on-surface-variant">暂无 SSH 密钥</p>
        ) : sshKeys.map((key) => (
          <div key={key.id} className="flex items-center gap-3 py-2 border-b border-outline-variant last:border-b-0">
            <div className="flex-1 min-w-0">
              <p className="body-small text-on-surface font-mono truncate">{key.fingerprint}</p>
              <p className="body-small text-on-surface-variant">
                {key.key_type} {key.comment ? `(${key.comment})` : ''} &middot; {new Date(key.created_at).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(key.id)}
              className="label-small text-error hover:underline flex-shrink-0"
            >
              删除
            </button>
          </div>
        ))}
        <Button variant="outlined" onClick={onAdd}>
          + 添加密钥
        </Button>
      </div>
    </SubSection>
  );
};

export default SshKeySection;
