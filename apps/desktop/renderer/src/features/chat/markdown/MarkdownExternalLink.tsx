import { Children, isValidElement, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { openExternalLink } from '../../../shared/lib/externalLinks.js';
import { ContextMenu } from '../../../shared/ui/ContextMenu.js';
import { AppTooltip } from '../../../shared/ui/primitives.js';
import { webLinkMenuItems } from '../../../shared/ui/webLinkMenuItems.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { MarkdownWebLinkIcon } from './MarkdownWebLinkIcon.js';

export function MarkdownExternalLink({
  children,
  href,
  onClick,
  title,
  ...props
}: ComponentPropsWithoutRef<'a'> & { href: string }) {
  const { t } = useI18n();
  const { onOpenInAppBrowser, onOpenWebLink } = useMarkdownNavigation();
  const webLink = /^https?:/i.test(href);
  const label = title?.trim() || linkLabelText(children).trim();
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
    <AppTooltip
      className="chat-markdown__link-tooltip"
      placement="topLeft"
      title={<>
        {label && label !== href ? <span className="chat-markdown__link-tooltip-title">{label}</span> : null}
        <span>{href}</span>
      </>}
    >
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
    </AppTooltip>
  );
  if (!webLink) return link;

  return (
    <ContextMenu trigger={['contextMenu']} menu={{ items: webLinkMenuItems(href, t, onOpenInAppBrowser) }}>
      {link}
    </ContextMenu>
  );
}

// Read the label without rendering its images or other Markdown components twice.
function linkLabelText(children: ReactNode): string {
  return Children.toArray(children).map((child): string => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (!isValidElement<{ children?: ReactNode; alt?: string }>(child)) return '';
    return child.props.alt ?? linkLabelText(child.props.children);
  }).join('');
}
