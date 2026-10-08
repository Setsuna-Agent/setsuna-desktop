import type { ComponentPropsWithoutRef, MouseEvent } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { openExternalLink } from '../../../shared/lib/externalLinks.js';
import { ContextMenu } from '../../../shared/ui/ContextMenu.js';
import { webLinkMenuItems } from '../../../shared/ui/webLinkMenuItems.js';
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
    openExternalLink(href);
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
    <ContextMenu trigger={['contextMenu']} menu={{ items: webLinkMenuItems(href, t, onOpenInAppBrowser) }}>
      {link}
    </ContextMenu>
  );
}
