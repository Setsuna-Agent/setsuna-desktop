import type { SettingsDialogProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Dialog } from '@setsuna-desktop/renderer-ui';

const dialogWidths = { small: 420, medium: 640, large: 720 } as const;

/** Feature content owns its layout; the shared dialog owns its surface and focus. */
export function SettingsDialog({ children, className, closeLabel, footer, onClose, size = 'medium', subtitle, title, titleIcon }: SettingsDialogProps) {
  return <Dialog className={className} closeLabel={closeLabel} footer={footer} onClose={onClose} width={dialogWidths[size]}
    title={<span className="sd-settings-dialog__title">{titleIcon ? <span className="sd-settings-dialog__title-icon">{titleIcon}</span> : null}{title}</span>}
    description={subtitle}>
    <div className="sd-settings-dialog__body">{children}</div>
  </Dialog>;
}
