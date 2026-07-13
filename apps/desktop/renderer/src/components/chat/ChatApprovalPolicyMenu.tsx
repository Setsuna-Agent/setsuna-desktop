import { type ComponentProps } from 'react';
import { Button, Dropdown } from 'antd';
import { Check, ChevronDown, LockKeyhole, ShieldCheck, UnlockKeyhole, type LucideIcon } from 'lucide-react';
import type { RuntimeConfigState } from '@setsuna-desktop/contracts';

type ApprovalPolicy = RuntimeConfigState['approvalPolicy'];

const approvalPolicyItems: Array<{
  description: string;
  icon: LucideIcon;
  label: string;
  value: ApprovalPolicy;
}> = [
  {
    value: 'strict',
    label: '严格授权',
    description: '非文件工具执行前总是确认',
    icon: LockKeyhole,
  },
  {
    value: 'on-request',
    label: '智能授权',
    description: '高风险工具会先确认',
    icon: ShieldCheck,
  },
  {
    value: 'full',
    label: '完全授权',
    description: '工具执行不再弹出确认',
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
        <span className="chat-authorization-menu__item" title={item.description}>
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
      // Windows reduced-motion mode can suppress transitionend and leave rc-motion's popup hidden.
      transitionName=""
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
        className={`chat-authorization-switch chat-approval-menu__trigger ${policy === 'full' ? 'chat-approval-menu__trigger--full-access' : ''}`}
        disabled={disabled}
      >
        <ActiveIcon className="chat-authorization-switch__icon" size={13} />
        <span className="chat-authorization-switch__label">{activeItem.label}</span>
        <ChevronDown className="chat-authorization-switch__arrow" size={12} />
      </Button>
    </Dropdown>
  );
}
