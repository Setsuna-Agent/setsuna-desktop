import { Button as ModeButton, Dropdown, Dialog } from '@setsuna-desktop/renderer-ui';
import {
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
import {
  localizedRuntimeAccessModeOptions,
  type LocalizedRuntimeAccessModeOption,
} from '../i18n/runtimeAccessModeCopy.js';
import {
  type RuntimeAccessMode,
} from '../lib/runtimeAccessMode.js';
import { Button, SelectField } from './primitives.js';

const modeIcons: Record<RuntimeAccessMode, LucideIcon> = {
  'request-approval': Hand,
  'agent-approval': ShieldCheck,
  'full-access': ShieldOff,
};

const fullAccessCapabilities = [
  { icon: Folder, title: 'accessMode.confirm.files', description: 'accessMode.confirm.filesDescription' },
  { icon: SquareTerminal, title: 'accessMode.confirm.terminal', description: 'accessMode.confirm.terminalDescription' },
  { icon: Globe2, title: 'accessMode.confirm.internet', description: 'accessMode.confirm.internetDescription' },
] as const;

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
    return {
      key: option.value,
      className: option.value === 'full-access' ? 'runtime-access-mode-menu__item--full-access' : undefined,
      label: (
        <span className="runtime-access-mode-menu__item">
          <RuntimeAccessModeOptionContent option={option} />
        </span>
      ),
    };
  });

  const settingsVariant = variant === 'settings';
  const requestModeChange = (nextMode: RuntimeAccessMode) => {
    if (nextMode !== 'full-access' || mode === 'full-access') {
      onChange(nextMode);
      return true;
    }
    setFullAccessConfirmationOpen(true);
    // The confirmation dialog takes focus; do not move it back to the closed select trigger.
    return false;
  };

  const confirmFullAccess = () => {
    setFullAccessConfirmationOpen(false);
    onChange('full-access');
  };
  const triggerClassName = mode === 'full-access' ? ' runtime-access-mode-trigger--full-access' : '';

  return (
    <>
      {settingsVariant ? (
        <SelectField
          aria-label={t('settings.runtime.permissionPolicy')}
          className={`settings-local-control chat-user-settings__runtime-policy-control runtime-access-mode-trigger runtime-access-mode-trigger--settings${triggerClassName}`}
          disabled={disabled}
          menuClassName="runtime-access-mode-menu-root runtime-access-mode-menu-root--select"
          menuMinWidth={320}
          value={mode}
          valueContent={<RuntimeAccessModeTriggerValue option={activeOption} />}
          onValueChange={(nextMode) => requestModeChange(nextMode as RuntimeAccessMode)}
        >
          {runtimeAccessModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              <span className={`runtime-access-mode-menu__item runtime-access-mode-menu__item--select${option.value === 'full-access' ? ' runtime-access-mode-menu__item--full-access' : ''}`}>
                <RuntimeAccessModeOptionContent option={option} />
              </span>
            </option>
          ))}
        </SelectField>
      ) : (
        <Dropdown
          rootClassName="runtime-access-mode-menu-root"
          trigger={['click']}
          placement="topLeft"
          disabled={disabled}
          menu={{
            items,
            selectedKeys: [mode],
            onClick: ({ key }) => requestModeChange(key as RuntimeAccessMode),
          }}
        >
          <ModeButton
            variant="ghost"
            size="small"
            className={`chat-authorization-switch chat-approval-menu__trigger runtime-access-mode-trigger${triggerClassName}`}
            disabled={disabled}
          >
            <ActiveIcon className="runtime-access-mode-trigger__icon" size={13} />
            <span className="runtime-access-mode-trigger__label">{activeOption.label}</span>
            <ChevronDown className="runtime-access-mode-trigger__arrow" size={12} />
          </ModeButton>
        </Dropdown>
      )}
      <Dialog
        aria-label={t('accessMode.confirm.label')}
        className="runtime-access-mode-confirm"
        title={t('accessMode.confirm.title')}
        description={t('accessMode.confirm.intro')}
        showClose={false}
        footer={(
          <>
            <Button onClick={() => setFullAccessConfirmationOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              icon={<TriangleAlert size={14} />}
              variant="danger"
              onClick={confirmFullAccess}
            >
              {t('accessMode.confirm.enable')}
            </Button>
          </>
        )}
        open={fullAccessConfirmationOpen}
        width={520}
        onClose={() => setFullAccessConfirmationOpen(false)}
      >
        <div className="runtime-access-mode-confirm__body">
          <ul className="runtime-access-mode-confirm__capabilities">
            {fullAccessCapabilities.map(({ icon: Icon, title, description }) => (
              <li className="runtime-access-mode-confirm__capability" key={title}>
                <Icon className="runtime-access-mode-confirm__capability-icon" size={18} aria-hidden="true" />
                <span className="runtime-access-mode-confirm__capability-copy">
                  <strong>{t(title)}</strong>
                  <small>{t(description)}</small>
                </span>
              </li>
            ))}
          </ul>
          <p className="runtime-access-mode-confirm__risk">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{t('accessMode.confirm.risk')}</span>
          </p>
        </div>
      </Dialog>
    </>
  );
}

function RuntimeAccessModeOptionContent({ option }: { option: LocalizedRuntimeAccessModeOption }) {
  const Icon = modeIcons[option.value];
  return (
    <>
      <Icon className="runtime-access-mode-menu__icon" size={14} />
      <span className="runtime-access-mode-menu__copy">
        <strong>{option.label}</strong>
        <small>{option.description}</small>
      </span>
    </>
  );
}

function RuntimeAccessModeTriggerValue({ option }: { option: LocalizedRuntimeAccessModeOption }) {
  const Icon = modeIcons[option.value];
  return (
    <span className="runtime-access-mode-trigger__value">
      <Icon className="runtime-access-mode-trigger__icon" size={13} />
      <span className="runtime-access-mode-trigger__label">{option.label}</span>
    </span>
  );
}
