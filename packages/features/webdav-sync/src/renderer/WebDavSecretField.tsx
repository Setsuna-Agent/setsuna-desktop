import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useWebDavSyncView } from './context.js';

type WebDavSecretFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  leadingIcon?: ReactNode;
};

/** Password input with an explicit, keyboard-accessible visibility toggle. */
export function WebDavSecretField({
  className = '',
  leadingIcon,
  ...props
}: WebDavSecretFieldProps) {
  const { t, ui: { IconButton, TextField } } = useWebDavSyncView();
  const [visible, setVisible] = useState(false);
  const toggleLabel = t(visible
    ? 'feature.webdavSync.connection.hideSecret'
    : 'feature.webdavSync.connection.showSecret');

  return (
    <span className={`settings-webdav__secret-field ${leadingIcon ? 'has-leading-icon' : ''}`}>
      {leadingIcon ? (
        <span aria-hidden="true" className="settings-webdav__secret-leading">{leadingIcon}</span>
      ) : null}
      <TextField
        {...props}
        className={`settings-webdav__secret-input ${className}`}
        type={visible ? 'text' : 'password'}
      />
      <IconButton
        aria-pressed={visible}
        className="settings-webdav__secret-toggle"
        disabled={props.disabled}
        label={toggleLabel}
        onClick={() => setVisible((current) => !current)}
        onMouseDown={(event) => event.preventDefault()}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconButton>
    </span>
  );
}
