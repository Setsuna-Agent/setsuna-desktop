import type {
  SettingsActionMenuProps,
  SettingsButtonProps,
  SettingsGroupProps,
  SettingsIconButtonProps,
  SettingsNavigationRowProps,
  SettingsPageHeadingProps,
  SettingsPageOutletProps,
  SettingsRowProps,
  SettingsSectionProps,
  SettingsSelectFieldProps,
  SettingsToastProps,
  SettingsTooltipProps,
  SettingsToggleProps,
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  settingsPageKey,
  settingsPageSlot,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Dropdown, type MenuProps } from 'antd';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useToast } from '../../app/providers/ToastProvider.js';
import {
  Button,
  Checkbox,
  AppTooltip,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  TextArea,
  TextField,
} from './primitives.js';
import { SettingsDialog } from './SettingsDialog.js';
import { SettingsDirectoryList } from './SettingsListFields.js';
import { PluginIcon } from './PluginIcon.js';
import { SkillIcon } from './SkillIcon.js';
import {
  RendererOwnedKeyedSlot,
  useRendererOwnedKeyedEntries,
} from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../i18n/I18nProvider.js';

/**
 * Concrete host implementation of the renderer Feature settings contract.
 * Feature code receives this object through its view props and never imports
 * renderer-internal components or relies on their CSS class names.
 */
export const settingsViewUi = Object.freeze({
  ActionMenu: SettingsActionMenu,
  Button: SettingsButton,
  Checkbox,
  Dialog: SettingsDialog,
  DirectoryList: SettingsDirectoryList,
  EmptyState,
  Group: SettingsGroup,
  IconButton: SettingsIconButton,
  NavigationRow: SettingsNavigationRow,
  PageHeader,
  PageHeading: SettingsPageHeading,
  PageOutlet: SettingsFeaturePageOutlet,
  PluginIcon,
  Row: SettingsRow,
  Section: SettingsSection,
  SelectField: SettingsSelectField,
  SkillIcon,
  TextArea,
  TextField,
  Toggle: SettingsToggle,
  Toast: SettingsToast,
  Tooltip: SettingsTooltip,
}) satisfies SettingsViewUi;

function SettingsActionMenu({ items, label, onSelect }: SettingsActionMenuProps) {
  const menuItems: MenuProps['items'] = items.map((item) => ({
    danger: item.danger,
    disabled: item.disabled,
    icon: item.icon,
    key: item.id,
    label: item.label,
  }));
  return (
    <Dropdown
      destroyOnHidden
      menu={{ items: menuItems, onClick: ({ key }) => onSelect(String(key)) }}
      placement="bottomRight"
      trigger={['click']}
    >
      <IconButton label={label}>
        <MoreHorizontal size={16} />
      </IconButton>
    </Dropdown>
  );
}

function SettingsFeaturePageOutlet({ sectionId }: SettingsPageOutletProps) {
  const { t } = useI18n();
  const key = settingsPageKey('capabilities', sectionId);
  const entry = useRendererOwnedKeyedEntries(settingsPageSlot).find((candidate) => candidate.key === key);
  if (!entry) return null;
  return (
    <SettingsOutletErrorBoundary
      key={entry.entryId}
      featureId={entry.owner.featureId ?? entry.owner.pluginId}
      retryLabel={t('featureRecovery.retryView')}
      title={t('featureRecovery.viewFailed')}
    >
      <RendererOwnedKeyedSlot
        entryKey={key}
        slot={settingsPageSlot}
        props={{ sectionId, translate: t, ui: settingsViewUi }}
      />
    </SettingsOutletErrorBoundary>
  );
}

class SettingsOutletErrorBoundary extends Component<
  Readonly<{
    children: ReactNode;
    featureId: string;
    retryLabel: string;
    title: string;
  }>,
  Readonly<{ failed: boolean }>
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('[renderer-feature] Nested settings contribution failed.', {
      errorName: error.name,
      featureId: this.props.featureId,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section data-feature-recovery="true" role="status">
        <EmptyState
          title={this.props.title}
          action={<Button onClick={() => this.setState({ failed: false })}>{this.props.retryLabel}</Button>}
        />
      </section>
    );
  }
}

export function SettingsPageHeading({ action, description, title }: SettingsPageHeadingProps) {
  return (
    <header className="chat-user-settings__page-heading">
      <div className="chat-user-settings__page-heading-copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function SettingsSection({ children, className = '', featureId }: SettingsSectionProps) {
  return (
    <div
      className={classNames(
        'chat-user-settings__section',
        'chat-user-settings__section--stacked',
        'sd-settings-view',
        className,
      )}
      data-feature-id={featureId}
    >
      {children}
    </div>
  );
}

export function SettingsGroup({ children, className = '', title }: SettingsGroupProps) {
  return (
    <div className={classNames('chat-user-settings__section-block', 'sd-settings-group-block', className)}>
      {title ? <div className="chat-user-settings__group-title sd-settings-group-title">{title}</div> : null}
      <div className="chat-user-settings__group sd-settings-group">{children}</div>
    </div>
  );
}

export function SettingsRow({ children, className = '', description, icon, label }: SettingsRowProps) {
  return (
    <div className={classNames(
      'chat-user-settings__row',
      'sd-settings-row',
      'sd-settings-field-row',
      description ? 'sd-settings-field-row--described' : '',
      className,
    )}>
      <span className="chat-user-settings__row-label sd-settings-row__label">
        {icon}
        <span className="sd-settings-row__copy">
          <span>{label}</span>
          {description ? <small>{description}</small> : null}
        </span>
      </span>
      <div className="settings-local-control sd-settings-row__control">{children}</div>
    </div>
  );
}

export function SettingsToggle({
  checked,
  description,
  disabled = false,
  icon,
  label,
  onChange,
}: SettingsToggleProps) {
  const accessibleLabel = typeof label === 'string' ? label : undefined;
  return (
    <div className="chat-user-settings__row chat-user-settings__toggle-row sd-settings-row sd-settings-toggle">
      <span className="chat-user-settings__row-label chat-user-settings__toggle-label sd-settings-row__label">
        {icon}
        <span className="chat-user-settings__toggle-copy sd-settings-row__copy">
          <span>{label}</span>
          <small>{description}</small>
        </span>
      </span>
      <label className="sd-check" title={accessibleLabel}>
        <input
          aria-label={accessibleLabel}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </label>
    </div>
  );
}

export function SettingsNavigationRow({
  actionLabel,
  disabled = false,
  icon,
  label,
  onClick,
}: SettingsNavigationRowProps) {
  return (
    <div className="chat-user-settings__row chat-user-settings__local-action-row sd-settings-navigation-row">
      <span className="chat-user-settings__row-label sd-settings-row__label">
        {icon}
        <span>{label}</span>
      </span>
      <Button
        className="sd-settings-navigation-row__action"
        disabled={disabled}
        icon={<ChevronRight size={14} />}
        onClick={onClick}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function SettingsButton(props: SettingsButtonProps) {
  return <Button {...props} />;
}

function SettingsIconButton(props: SettingsIconButtonProps) {
  return <IconButton {...props} />;
}

function SettingsSelectField(props: SettingsSelectFieldProps) {
  return <SelectField {...props} />;
}

function SettingsTooltip(props: SettingsTooltipProps) {
  return <AppTooltip {...props} />;
}

function SettingsToast({ message, tone = 'info' }: SettingsToastProps) {
  const toast = useToast();

  useEffect(() => {
    toast.show(message, { tone });
  }, [message, toast, tone]);

  return null;
}

function classNames(...values: string[]): string {
  return values.filter(Boolean).join(' ');
}
