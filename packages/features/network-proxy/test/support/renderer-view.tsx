import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { networkProxyMessages } from '../../src/renderer/messages.js';

const Button: SettingsViewUi['Button'] = ({ children, icon, ...props }) => (
  <button {...props} type={props.type ?? 'button'}>{icon}{children}</button>
);
const IconButton: SettingsViewUi['IconButton'] = ({ children, label, ...props }) => (
  <button {...props} aria-label={label}>{children}</button>
);

export const testSettingsViewUi: SettingsViewUi = Object.freeze({
  Button,
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

export const translateNetworkProxyForTest: RendererTranslate = (key, params) => {
  const catalog = networkProxyMessages.messages['zh-CN'] ?? {};
  const template = catalog[key] ?? key;
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template,
  );
};
