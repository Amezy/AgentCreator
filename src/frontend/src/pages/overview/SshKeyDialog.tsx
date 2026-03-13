/**
 * @module SshKeyDialog
 * @description SSH 公钥添加弹窗组件。
 * 提供文本域供用户粘贴 SSH 公钥内容（ssh-rsa、ssh-ed25519 等格式），
 * 提交后调用后端 API 将公钥关联到指定用户。
 */
import React, { useState } from 'react';
import { Modal } from './shared';
import { addSshKey } from '../../services/api';
import TextArea from '../../components/m3/TextArea';

interface Props {
  open: boolean;
  userId: number;
  onClose: () => void;
  onSuccess: () => void;
  toast: (msg: string) => void;
}

const SshKeyDialog: React.FC<Props> = ({ open, userId, onClose, onSuccess, toast }) => {
  const [publicKey, setPublicKey] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!publicKey.trim()) return;
    setLoading(true);
    try {
      await addSshKey(userId, publicKey.trim());
      toast('SSH 密钥已添加');
      setPublicKey('');
      onSuccess();
    } catch (err) {
      toast(`添加失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPublicKey('');
    onClose();
  };

  return (
    <Modal
      open={open}
      title="添加 SSH 公钥"
      onClose={handleClose}
      onConfirm={handleSubmit}
      confirmLabel={loading ? '添加中...' : '添加'}
      confirmDisabled={!publicKey.trim() || loading}
    >
      <div className="space-y-3">
        <p className="body-medium text-on-surface-variant">
          请粘贴你的 SSH 公钥 (以 ssh-rsa、ssh-ed25519 等开头)
        </p>
        <TextArea
          label="公钥内容"
          value={publicKey}
          onChange={setPublicKey}
          rows={4}
        />
      </div>
    </Modal>
  );
};

export default SshKeyDialog;
