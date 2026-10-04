import { IconButton } from '@setsuna-desktop/renderer-ui';
import { Pin, PinOff, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BrowserRecordsProps } from './BrowserRecordsManager.js';

export function BrowserRecordsHeader({ title, actions, translate: t, onClose, pinned, onTogglePinned }: BrowserRecordsProps & {
  title: string; actions?: ReactNode;
}) {
  return <header className="browser-records__header">
    <h2>{title}</h2><div className="browser-records__header-actions">{actions}
      {onTogglePinned ? <IconButton label={t(pinned ? 'feature.browser.records.unpin' : 'feature.browser.records.pin')} onClick={onTogglePinned}>
        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </IconButton> : null}
      <IconButton label={t('feature.browser.settings.close')} onClick={onClose}><X size={14} /></IconButton>
    </div>
  </header>;
}
