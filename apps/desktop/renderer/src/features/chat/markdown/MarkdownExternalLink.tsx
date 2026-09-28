import { Copy, ExternalLink, Globe2 } from 'lucide-react';
import type { ComponentPropsWithoutRef, MouseEvent } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';
import { ContextMenu } from '../../../shared/ui/ContextMenu.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { MarkdownWebLinkIcon } from './MarkdownWebLinkIcon.js';

export function MarkdownExternalLink({
  children,
  href,
  onClick,
  ...props
}: ComponentPropsWithoutRef<'a'> & { href: string }) {
  const { t } = useI18n();
  const { onOpenInAppBrowser, onOpenWebLink } = useMarkdownNavigation();
  const webLink = /^https?:/i.test(href);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (webLink && onOpenWebLink) {
      onOpenWebLink(href);
      return;
    }
    openExternalMarkdownLink(href);
  };
  const link = (
    <a
      {...props}
      className={[props.className, webLink ? 'chat-markdown__web-link' : ''].filter(Boolean).join(' ') || undefined}
      data-markdown-link={webLink ? 'web' : 'external'}
      href={href}
      onClick={handleClick}
      rel="noreferrer"
      target="_blank"
    >
      {webLink ? <MarkdownWebLinkIcon href={href} /> : null}
      {children}
    </a>
  );
  if (!webLink) return link;

  return (
    <ContextMenu trigger={['contextMenu']} menu={{ items: [
      {
        key: 'copy-link', label: t('chat.markdown.copyLink'), icon: <Copy size={14} />,
        onClick: () => {
          void copyTextToClipboard(href).catch((error: unknown) => {
            console.error('[MarkdownExternalLink] failed to copy link', error);
          });
        },
      },
      { type: 'divider' },
      {
        key: 'open-in-app', label: t('chat.markdown.openInAppBrowser'), icon: <Globe2 size={14} />,
        disabled: !onOpenInAppBrowser,
        // Explicit menu actions bypass the preference used by a normal link click.
        onClick: () => onOpenInAppBrowser?.(href),
      },
      {
        key: 'open-external', label: t('chat.markdown.openExternalBrowser'), icon: <ExternalLink size={14} />,
        onClick: () => openExternalMarkdownLink(href),
      },
    ] }}>
      {link}
    </ContextMenu>
  );
}

function openExternalMarkdownLink(href: string): void {
  if (typeof window === 'undefined') return;
  const openExternal = window.setsunaDesktop?.links?.openExternal;
  if (openExternal) {
    void openExternal(href).catch((error: unknown) => {
      console.error('[MarkdownExternalLink] failed to open external link', error);
    });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}
