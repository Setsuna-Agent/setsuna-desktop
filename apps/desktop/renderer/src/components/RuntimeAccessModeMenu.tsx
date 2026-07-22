import { type ComponentProps } from 'react';
import { Button, Dropdown, Modal } from 'antd';
import { Check, ChevronDown, FolderOpen, Globe2, Hand, ShieldCheck, ShieldOff, SquareTerminal, TriangleAlert, type LucideIcon } from 'lucide-react';
import {
  runtimeAccessModeOptions,
  type RuntimeAccessMode,
} from '../utils/runtimeAccessMode.js';

const modeIcons: Record<RuntimeAccessMode, LucideIcon> = {
  'request-approval': Hand,
  'agent-approval': ShieldCheck,
  'full-access': ShieldOff,
};

export function RuntimeAccessModeMenu({
  disabled,
  mode,
  onChange,
  variant = 'chat',
}: {
  disabled?: boolean;
  mode: RuntimeAccessMode;
  onChange: (mode: RuntimeAccessMode) => void;
  variant?: 'chat' | 'settings';
}) {
  const [modal, modalContextHolder] = Modal.useModal();
  const activeOption = runtimeAccessModeOptions.find((option) => option.value === mode) ?? runtimeAccessModeOptions[1];
  const ActiveIcon = modeIcons[activeOption.value];
  const items: NonNullable<ComponentProps<typeof Dropdown>['menu']>['items'] = runtimeAccessModeOptions.map((option) => {
    const Icon = modeIcons[option.value];
    return {
      key: option.value,
      className: option.value === 'full-access' ? 'runtime-access-mode-menu__item--full-access' : undefined,
      label: (
        <span className="runtime-access-mode-menu__item">
          <Icon className="runtime-access-mode-menu__icon" size={14} />
          <span className="runtime-access-mode-menu__copy">
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
          <span className="runtime-access-mode-menu__check">
            {option.value === mode ? <Check size={14} /> : null}
          </span>
        </span>
      ),
    };
  });

  const settingsVariant = variant === 'settings';
  const requestModeChange = (nextMode: RuntimeAccessMode) => {
    if (nextMode !== 'full-access' || mode === 'full-access') {
      onChange(nextMode);
      return;
    }
    void modal.confirm({
      className: 'runtime-access-mode-confirm',
      title: '确定要切换到完全访问吗？',
      icon: <TriangleAlert color="var(--app-warning)" size={20} />,
      content: (
        <div className="runtime-access-mode-confirm__content">
          <p>完全访问会关闭 OS 沙箱，并在不请求批准的情况下开放以下能力：</p>
          <div className="runtime-access-mode-confirm__capabilities">
            <span><FolderOpen size={16} /><span><strong>任意文件</strong><small>读取、创建、修改或删除电脑上的文件</small></span></span>
            <span><SquareTerminal size={16} /><span><strong>终端命令</strong><small>运行命令、安装软件和更改系统设置</small></span></span>
            <span><Globe2 size={16} /><span><strong>互联网</strong><small>访问网站、发送数据并使用已启用的连接能力</small></span></span>
          </div>
          <p className="runtime-access-mode-confirm__risk">这可能造成敏感数据泄露、数据丢失或提示注入风险。仅在信任当前任务时启用。</p>
        </div>
      ),
      okText: '启用完全访问',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => onChange(nextMode),
    });
  };
  return (
    <>
      {modalContextHolder}
      <Dropdown
        rootClassName="runtime-access-mode-menu-root"
        trigger={['click']}
        placement={settingsVariant ? 'bottomRight' : 'topLeft'}
        transitionName=""
        disabled={disabled}
        menu={{
          items,
          selectedKeys: [mode],
          onClick: ({ key }) => requestModeChange(key as RuntimeAccessMode),
        }}
      >
        <Button
          type={settingsVariant ? 'default' : 'text'}
          size="small"
          className={`${settingsVariant
            ? 'settings-local-control chat-user-settings__runtime-policy-control runtime-access-mode-trigger runtime-access-mode-trigger--settings'
            : 'chat-authorization-switch chat-approval-menu__trigger runtime-access-mode-trigger'} ${mode === 'full-access' ? 'runtime-access-mode-trigger--full-access' : ''}`}
          disabled={disabled}
        >
          <ActiveIcon className="runtime-access-mode-trigger__icon" size={13} />
          <span className="runtime-access-mode-trigger__label">{activeOption.label}</span>
          <ChevronDown className="runtime-access-mode-trigger__arrow" size={12} />
        </Button>
      </Dropdown>
    </>
  );
}
