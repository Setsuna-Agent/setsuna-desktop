import type { SettingsDialogProps } from '@setsuna-desktop/feature-core/renderer';
import { Modal } from 'antd';
import { X } from 'lucide-react';

const dialogWidths = Object.freeze({
  small: 420,
  medium: 640,
  large: 720,
});

/**
 * Canonical shell for settings dialogs. Feature content owns its internal
 * layout; the host owns modal structure, density, focus handling and theme.
 */
export function SettingsDialog({
  children,
  className = '',
  closeLabel,
  footer,
  onClose,
  size = 'medium',
  subtitle,
  title,
  titleIcon,
}: SettingsDialogProps) {
  return (
    <Modal
      centered
      className={['sd-settings-dialog', className].filter(Boolean).join(' ')}
      closable={{ 'aria-label': closeLabel }}
      closeIcon={<X aria-hidden="true" size={15} />}
      footer={footer ?? null}
      open
      styles={{ container: { padding: 0 } }}
      title={(
        <div className="sd-settings-dialog__title">
          {titleIcon ? <span className="sd-settings-dialog__title-icon">{titleIcon}</span> : null}
          <span className="sd-settings-dialog__title-copy">
            <strong>{title}</strong>
            {subtitle ? <small>{subtitle}</small> : null}
          </span>
        </div>
      )}
      width={dialogWidths[size]}
      onCancel={onClose}
    >
      <div className="sd-settings-dialog__body">{children}</div>
    </Modal>
  );
}
