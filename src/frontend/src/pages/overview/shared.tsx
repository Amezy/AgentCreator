/**
 * @module shared
 * @description 概览页面的共享工具模块。
 * 包含模型选项映射、辅助函数（模型/提供商标签转换）、
 * 通用 UI 组件（图标、状态徽章、角色徽章、可折叠子区块、弹窗、分段按钮）。
 * 被 Overview 及其子组件广泛复用。
 */
import React, { useState } from 'react';
import Button from '../../components/m3/Button';
import { CheckIcon } from '../../components/icons/Icons';

// ── Model Options (consistent with wizard ModelConfig) ──

export const MODEL_OPTIONS_BY_PROVIDER: Record<string, { value: string; label: string; disabled?: boolean }[]> = {
  anthropic: [
    { value: 'opus4.6', label: 'Opus 4.6' },
    { value: 'sonnet4.6', label: 'Sonnet 4.6' },
  ],
  google: [
    { value: 'gemini3flash', label: 'Gemini3 Flash' },
    { value: 'gemini31pro', label: 'Gemini3.1 Pro' },
  ],
  openai: [
    { value: 'gpt53codex', label: 'GPT-5.3 Codex', disabled: true },
  ],
};

export const ALL_MODELS = Object.entries(MODEL_OPTIONS_BY_PROVIDER).flatMap(([provider, models]) =>
  models.map((m) => ({ ...m, provider }))
);

// Legacy model name mapping (old DB entries used different naming)
export const LEGACY_MODEL_MAP: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4': 'Opus 4.6',
  'claude-sonnet-4': 'Sonnet 4.6',
  'gemini-3-flash': 'Gemini3 Flash',
  'gemini-3.1-pro': 'Gemini3.1 Pro',
};

export function getModelLabel(modelName: string): string {
  const found = ALL_MODELS.find((m) => m.value === modelName);
  if (found) return found.label;
  const legacy = LEGACY_MODEL_MAP[modelName];
  if (legacy) return legacy;
  return modelName;
}

export function getProviderLabel(provider: string): string {
  const map: Record<string, string> = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI' };
  return map[provider] || provider;
}

// ── Icons ──

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={`text-on-surface-variant transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/>
  </svg>
);

export const StatusBadge = ({ ok, okText = '已验证', noText = '未验证' }: { ok: boolean; okText?: string; noText?: string }) => (
  <span className={`inline-flex items-center gap-1 label-small px-2 py-0.5 rounded-full ${ok ? 'bg-primary/10 text-primary' : 'bg-outline/10 text-on-surface-variant'}`}>
    {ok && <CheckIcon size={12} />}
    {ok ? okText : noText}
  </span>
);

export const RoleBadge = ({ role }: { role: string }) => (
  <span className={`label-small px-2 py-0.5 rounded-full ${role === 'admin' ? 'bg-tertiary/10 text-tertiary' : 'bg-primary/10 text-primary'}`}>
    {role === 'admin' ? '管理员' : '开发者'}
  </span>
);

// ── Section Icons ──

export const icons = {
  model: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.5-9.11 0-12.58 3.51-3.47 9.21-3.47 12.72 0L21 3v7.12z" fill="currentColor"/>
    </svg>
  ),
  team: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/>
    </svg>
  ),
  deploy: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" fill="currentColor"/>
    </svg>
  ),
  repo: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" fill="currentColor"/>
    </svg>
  ),
  vscode: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H7V4h10v16zM8 6h8v2H8V6zm0 4h8v2H8v-2zm0 4h5v2H8v-2z" fill="currentColor"/>
    </svg>
  ),
  claude: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
    </svg>
  ),
  sshKey: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary">
      <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" fill="currentColor"/>
    </svg>
  ),
};

// ── Modal Dialog ──

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ open, title, onClose, onConfirm, confirmLabel = '确定', confirmDisabled, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40" onClick={onClose}>
      <div className="bg-surface rounded-xl shadow-elevation-3 p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="title-large text-on-surface">{title}</h3>
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="text" onClick={onClose}>取消</Button>
          {onConfirm && (
            <Button variant="filled" onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</Button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Segmented button helper ──

export const Seg = ({ options, value, onChange }: { options: { k: string; l: string }[]; value: string; onChange: (v: string) => void }) => (
  <div className="flex rounded-xl border border-outline-variant overflow-hidden">
    {options.map(({ k, l }) => (
      <button key={k} type="button" onClick={() => onChange(k)} className={`px-3 py-1.5 label-medium transition-colors ${value === k ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>{l}</button>
    ))}
  </div>
);

// ── Collapsible Sub-Section ──

interface SubSectionProps {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const SubSection: React.FC<SubSectionProps> = ({ icon, title, badge, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-outline-variant rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surface-container/50 transition-colors"
      >
        {icon}
        <span className="label-large text-on-surface">{title}</span>
        {badge && (
          <span className="label-small text-on-surface-variant bg-surface-container-highest px-1.5 py-0.5 rounded-full">{badge}</span>
        )}
        <div className="flex-1" />
        <ChevronIcon open={open} />
      </button>
      {open && <div className="border-t border-outline-variant">{children}</div>}
    </div>
  );
};
