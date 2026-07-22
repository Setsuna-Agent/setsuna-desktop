import { Button as AntButton, Dropdown, Modal } from 'antd';
import {
  Check,
  ChevronDown,
  Folder,
  Globe2,
  Hand,
  ShieldCheck,
  ShieldOff,
  SquareTerminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { localizedRuntimeAccessModeOptions } from '../i18n/runtimeAccessModeCopy.js';
import {
  type RuntimeAccessMode,
} from '../lib/runtimeAccessMode.js';
import { Button } from './primitives.js';

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
  const { t } = useI18n();
  const [fullAccessConfirmationOpen, setFullAccessConfirmationOpen] = useState(false);
  const runtimeAccessModeOptions = localizedRuntimeAccessModeOptions(t);
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
    setFullAccessConfirmationOpen(true);
  };

  const confirmFullAccess = () => {
    setFullAccessConfirmationOpen(false);
    onChange('full-access');
  };

  return (
    <>
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
        <AntButton
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
        </AntButton>
      </Dropdown>
      <Modal
        aria-label={t('accessMode.confirm.label')}
        centered
        className="runtime-access-mode-confirm"
        closable={false}
        destroyOnHidden
        footer={null}
        mask={{ closable: true }}
        open={fullAccessConfirmationOpen}
        rootClassName="runtime-access-mode-confirm-root"
        width={520}
        onCancel={() => setFullAccessConfirmationOpen(false)}
      >
        <div className="runtime-access-mode-confirm__dialog">
          <header className="runtime-access-mode-confirm__header">
            <TriangleAlert size={17} aria-hidden="true" />
            <h2>{t('accessMode.confirm.title')}</h2>
          </header>
          <p className="runtime-access-mode-confirm__intro">
            {t('accessMode.confirm.intro')}
          </p>
          <div className="runtime-access-mode-confirm__capabilities">
            <div className="runtime-access-mode-confirm__capability">
              <span className="runtime-access-mode-confirm__capability-icon is-files" aria-hidden="true">
                <Folder size={17} />
              </span>
              <span className="runtime-access-mode-confirm__capability-copy">
                <strong>{t('accessMode.confirm.files')}</strong>
                <small>{t('accessMode.confirm.filesDescription')}</small>
              </span>
            </div>
            <div className="runtime-access-mode-confirm__capability">
              <span className="runtime-access-mode-confirm__capability-icon is-terminal" aria-hidden="true">
                <SquareTerminal size={15} />
              </span>
              <span className="runtime-access-mode-confirm__capability-copy">
                <strong>{t('accessMode.confirm.terminal')}</strong>
                <small>{t('accessMode.confirm.terminalDescription')}</small>
              </span>
            </div>
            <div className="runtime-access-mode-confirm__capability">
              <span className="runtime-access-mode-confirm__capability-icon is-internet" aria-hidden="true">
                <Globe2 size={17} />
              </span>
              <span className="runtime-access-mode-confirm__capability-copy">
                <strong>{t('accessMode.confirm.internet')}</strong>
                <small>{t('accessMode.confirm.internetDescription')}</small>
              </span>
            </div>
          </div>
          <p className="runtime-access-mode-confirm__risk">
            {t('accessMode.confirm.risk')}
          </p>
          <footer className="runtime-access-mode-confirm__actions">
            <Button
              autoFocus
              className="runtime-access-mode-confirm__cancel"
              onClick={() => setFullAccessConfirmationOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="runtime-access-mode-confirm__enable"
              icon={<TriangleAlert size={14} />}
              variant="danger"
              onClick={confirmFullAccess}
            >
              {t('accessMode.confirm.enable')}
            </Button>
          </footer>
        </div>
      </Modal>
    </>
  );
}
