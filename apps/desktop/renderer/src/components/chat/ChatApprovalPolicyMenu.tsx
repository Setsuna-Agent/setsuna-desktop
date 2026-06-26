import { useRef, useState } from 'react';
import { Check, ChevronDown, LockKeyhole, ShieldAlert, ShieldCheck, UnlockKeyhole } from 'lucide-react';
import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { useOutsideClose } from './chatComposerControlUtils.js';

type ApprovalPolicy = RuntimeConfigState['approvalPolicy'];
type PermissionProfile = RuntimeConfigState['permissionProfile'];

const approvalPolicyItems: Array<{
  description: string;
  icon: typeof ShieldCheck;
  label: string;
  value: ApprovalPolicy;
}> = [
  {
    value: 'on-request',
    label: '智能授权',
    description: '写入和高风险工具会先确认',
    icon: ShieldCheck,
  },
  {
    value: 'suggest',
    label: '建议确认',
    description: '按工具风险建议处理',
    icon: ShieldAlert,
  },
  {
    value: 'strict',
    label: '严格授权',
    description: '工具执行前总是确认',
    icon: LockKeyhole,
  },
];

const permissionProfileItems: Array<{
  description: string;
  icon: typeof ShieldCheck;
  label: string;
  value: PermissionProfile;
}> = [
  {
    value: 'workspace-write',
    label: '工作区写入',
    description: '允许修改当前项目内文件',
    icon: ShieldCheck,
  },
  {
    value: 'read-only',
    label: '只读',
    description: '禁止文件写入和高风险命令',
    icon: LockKeyhole,
  },
  {
    value: 'danger-full-access',
    label: '完全访问',
    description: '允许访问工作区外路径',
    icon: UnlockKeyhole,
  },
];

export function ChatApprovalPolicyMenu({
  disabled,
  policy,
  onChange,
}: {
  disabled?: boolean;
  policy: ApprovalPolicy;
  onChange: (policy: ApprovalPolicy) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const activeItem = approvalPolicyItems.find((item) => item.value === policy) ?? approvalPolicyItems[0];
  const ActiveIcon = activeItem.icon;

  useOutsideClose(rootRef, open, () => setOpen(false));

  return (
    <span ref={rootRef} className="chat-footer-menu-root chat-approval-menu">
      <button
        className={`chat-sender-chip chat-approval-menu__trigger ${open ? 'is-active' : ''}`}
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveIcon size={13} />
        <span>{activeItem.label}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="chat-footer-menu chat-approval-menu__panel">
          {approvalPolicyItems.map((item) => {
            const Icon = item.icon;
            const selected = item.value === policy;
            return (
              <button
                key={item.value}
                className={`chat-footer-menu__item chat-approval-menu__item ${selected ? 'is-selected' : ''}`}
                type="button"
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <Icon className="chat-footer-menu__item-icon" size={15} />
                <span className="chat-footer-menu__item-main">
                  <span>{item.label}</span>
                  <em>{item.description}</em>
                </span>
                <span className="chat-footer-menu__check">{selected ? <Check size={14} /> : null}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

export function ChatPermissionProfileMenu({
  disabled,
  profile,
  onChange,
}: {
  disabled?: boolean;
  profile: PermissionProfile;
  onChange: (profile: PermissionProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const activeItem = permissionProfileItems.find((item) => item.value === profile) ?? permissionProfileItems[0];
  const ActiveIcon = activeItem.icon;

  useOutsideClose(rootRef, open, () => setOpen(false));

  return (
    <span ref={rootRef} className="chat-footer-menu-root chat-permission-menu">
      <button
        className={`chat-sender-chip chat-permission-menu__trigger ${open ? 'is-active' : ''}`}
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveIcon size={13} />
        <span>{activeItem.label}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="chat-footer-menu chat-permission-menu__panel">
          {permissionProfileItems.map((item) => {
            const Icon = item.icon;
            const selected = item.value === profile;
            return (
              <button
                key={item.value}
                className={`chat-footer-menu__item chat-permission-menu__item ${selected ? 'is-selected' : ''}`}
                type="button"
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <Icon className="chat-footer-menu__item-icon" size={15} />
                <span className="chat-footer-menu__item-main">
                  <span>{item.label}</span>
                  <em>{item.description}</em>
                </span>
                <span className="chat-footer-menu__check">{selected ? <Check size={14} /> : null}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
