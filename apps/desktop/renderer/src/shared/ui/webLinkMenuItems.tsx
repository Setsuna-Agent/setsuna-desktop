import type { MenuItem } from '@setsuna-desktop/renderer-ui';
import { Copy, ExternalLink, Globe2 } from 'lucide-react';
import type { Translate } from '../i18n/I18nProvider.js';
import { copyTextToClipboard } from '../lib/clipboard.js';
import { openExternalLink } from '../lib/externalLinks.js';

export function webLinkMenuItems(
  href: string,
  translate: Translate,
  onOpenInAppBrowser?: (url: string) => void,
): MenuItem[] {
  return [
    {
      key: 'copy-link', label: translate('chat.markdown.copyLink'), icon: <Copy size={14} />,
      onClick: () => {
        void copyTextToClipboard(href).catch((error: unknown) => {
          console.error('[links] failed to copy link', error);
        });
      },
    },
    { type: 'divider' },
    {
      key: 'open-in-app', label: translate('chat.markdown.openInAppBrowser'), icon: <Globe2 size={14} />,
      disabled: !onOpenInAppBrowser,
      // Explicit menu actions bypass the preference used by a normal link click.
      onClick: () => onOpenInAppBrowser?.(href),
    },
    {
      key: 'open-external', label: translate('chat.markdown.openExternalBrowser'), icon: <ExternalLink size={14} />,
      onClick: () => openExternalLink(href),
    },
  ];
}
