import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import type { ReactNode } from 'react';
import type { WebDavSyncDesktopBridge } from '../../src/contracts/index.js';
import { WebDavSyncViewProvider } from '../../src/renderer/context.js';
import { webDavSyncMessages } from '../../src/renderer/messages.js';

const Button: SettingsViewUi['Button'] = ({ children, icon, ...props }) => (
  <button {...props} type={props.type ?? 'button'}>{icon}{children}</button>
);
const IconButton: SettingsViewUi['IconButton'] = ({ children, label, ...props }) => (
  <button {...props} aria-label={label}>{children}</button>
);
const Checkbox: SettingsViewUi['Checkbox'] = ({
  checked,
  children,
  className,
  indeterminate,
  onChange,
  onClick,
  ...props
}) => (
  <label className={className} onClick={onClick}>{children}<input
    {...props}
    ref={(input) => { if (input) input.indeterminate = Boolean(indeterminate); }}
    checked={checked}
    type="checkbox"
    onChange={(event) => onChange(event.currentTarget.checked)}
  /></label>
);

export const testSettingsViewUi: SettingsViewUi = Object.freeze({
  Button,
  Checkbox,
  EmptyState: ({ action, body, title }) => <div><strong>{title}</strong>{body}{action}</div>,
  Group: ({ children }) => <section>{children}</section>,
  IconButton,
  NavigationRow: ({ actionLabel, disabled, label, onClick }) => (
    <button disabled={disabled} onClick={onClick}>{label}{actionLabel}</button>
  ),
  Row: ({ children, description, label }) => <div>{label}{description}{children}</div>,
  Section: ({ children, className, featureId }) => (
    <section className={className} data-feature-id={featureId}>{children}</section>
  ),
  SelectField: ({ children, onValueChange, value, valueContent: _valueContent, ...props }) => (
    <select
      {...props}
      value={value}
      onChange={(event) => { onValueChange(event.currentTarget.value); }}
    >
      {children}
    </select>
  ),
  TextArea: (props) => <textarea {...props} />,
  TextField: (props) => <input {...props} />,
  Toggle: ({ checked, description, disabled, label, onChange }) => (
    <label>{label}{description}<input
      checked={checked}
      disabled={disabled}
      type="checkbox"
      onChange={(event) => onChange(event.currentTarget.checked)}
    /></label>
  ),
  Tooltip: ({ children }) => children,
});

const translate: RendererTranslate = (key, params) => {
  const catalog = webDavSyncMessages.messages['zh-CN'] ?? {};
  const template = catalog[key] ?? key;
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template,
  );
};

export function TestWebDavSyncView({
  bridge = null,
  children,
}: Readonly<{
  bridge?: WebDavSyncDesktopBridge | null;
  children: ReactNode;
}>) {
  return (
    <WebDavSyncViewProvider
      bridge={bridge}
      locale="zh-CN"
      translate={translate}
      ui={testSettingsViewUi}
    >
      {children}
    </WebDavSyncViewProvider>
  );
}
