import { useRef, useState, type ComponentProps } from 'react';
import { Button, Dropdown } from 'antd';
import { Check, ChevronDown, LockKeyhole, ShieldCheck, UnlockKeyhole, type LucideIcon } from 'lucide-react';
import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { useOutsideClose } from './chatComposerControlUtils.js';

type ApprovalPolicy = RuntimeConfigState['approvalPolicy'];
type PermissionProfile = RuntimeConfigState['permissionProfile'];

const approvalPolicyItems: Array<{
  description: string;
  icon: LucideIcon;
  label: string;
  value: ApprovalPolicy;
}> = [
  {
    value: 'strict',
    label: '严格授权',
    description: '工具执行前总是确认',
    icon: LockKeyhole,
  },
  {
    value: 'on-request',
    label: '智能授权',
    description: '写入和高风险工具会先确认',
    icon: ShieldCheck,
  },
  {
    value: 'full',
    label: '完全授权',
    description: '工具执行不再弹出确认',
    icon: UnlockKeyhole,
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
  const activeItem = approvalPolicyItems.find((item) => item.value === policy) ?? approvalPolicyItems[0];
  const ActiveIcon = activeItem.icon;
  const items: NonNullable<ComponentProps<typeof Dropdown>['menu']>['items'] = approvalPolicyItems.map((item) => {
    const Icon = item.icon;
    const selected = item.value === policy;
    return {
      key: item.value,
      label: (
        <span className="chat-authorization-menu__item">
          <Icon className="chat-authorization-menu__icon" size={13} />
          <span>{item.label}</span>
          <span className="chat-authorization-menu__check">{selected ? <Check size={13} /> : null}</span>
        </span>
      ),
    };
  });

  return (
    <Dropdown
      rootClassName="chat-authorization-menu-root"
      trigger={['click']}
      placement="topLeft"
      disabled={disabled}
      menu={{
        items,
        selectedKeys: [policy],
        onClick: ({ key }) => onChange(key as ApprovalPolicy),
      }}
    >
      <Button
        type="text"
        size="small"
        className="chat-authorization-switch chat-approval-menu__trigger"
        disabled={disabled}
      >
        <ActiveIcon className="chat-authorization-switch__icon" size={13} />
        <span className="chat-authorization-switch__label">{activeItem.label}</span>
        <ChevronDown className="chat-authorization-switch__arrow" size={12} />
      </Button>
    </Dropdown>
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
