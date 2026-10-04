import { Button, IconButton, TextField, SelectField, Dropdown } from '@setsuna-desktop/renderer-ui';
import { MoreHorizontal } from 'lucide-react';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';

export const settingsTestUi = {
  Button, IconButton, TextField, SelectField,
  Dialog: ({ children }) => <div role="dialog">{children}</div>,
  EmptyState: ({ title }) => <p>{title}</p>,
  Toast: ({ message }) => <p role="alert">{message}</p>,
  PageHeading: ({ title }) => <h1>{title}</h1>,
  PageLayout: ({ title, parent, children }) => <div>{parent ? <Button onClick={parent.onBack}>Back</Button> : null}<h1>{title}</h1>{children}</div>,
  Section: ({ children }) => <div>{children}</div>,
  Group: ({ title, children }) => <section aria-label={typeof title === 'string' ? title : undefined}>{children}</section>,
  Row: ({ label, children }) => <div><span>{label}</span>{children}</div>,
  NavigationRow: ({ label, onClick }) => <Button onClick={onClick}>{label}</Button>,
  Toggle: ({ label, checked, disabled, onChange }) => <label>{label}<input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>,
  ActionMenu: ({ label, items, onSelect }) => <Dropdown menu={{ items: items.map((item) => ({ ...item, key: item.id })), onClick: ({ key }) => onSelect(String(key)) }}>
    <IconButton label={label}><MoreHorizontal size={14} /></IconButton>
  </Dropdown>,
} satisfies Partial<SettingsViewUi>;
