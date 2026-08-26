import type {
  SettingsButtonProps,
  SettingsGroupProps,
  SettingsIconButtonProps,
  SettingsNavigationRowProps,
  SettingsPageHeadingProps,
  SettingsRowProps,
  SettingsSectionProps,
  SettingsSelectFieldProps,
  SettingsToastProps,
  SettingsTooltipProps,
  SettingsToggleProps,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { useToast } from '../../app/providers/ToastProvider.js';
import {
  Button,
  Checkbox,
  AppTooltip,
  EmptyState,
  IconButton,
  SelectField,
  TextArea,
  TextField,
} from './primitives.js';
import { SettingsDialog } from './SettingsDialog.js';

/**
 * Concrete host implementation of the renderer Feature settings contract.
 * Feature code receives this object through its view props and never imports
 * renderer-internal components or relies on their CSS class names.
 */
export const settingsViewUi = Object.freeze({
  Button: SettingsButton,
  Checkbox,
  Dialog: SettingsDialog,
  EmptyState,
  Group: SettingsGroup,
  IconButton: SettingsIconButton,
  NavigationRow: SettingsNavigationRow,
  PageHeading: SettingsPageHeading,
  Row: SettingsRow,
  Section: SettingsSection,
  SelectField: SettingsSelectField,
  TextArea,
  TextField,
  Toggle: SettingsToggle,
  Toast: SettingsToast,
  Tooltip: SettingsTooltip,
}) satisfies SettingsViewUi;

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
