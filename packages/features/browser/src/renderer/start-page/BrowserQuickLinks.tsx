import { Button, IconButton, Tooltip } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ChevronRight, Pin, PinOff } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/index.js';
import type { BrowserTranslate } from '../messages.js';
import { useBrowserBookmarks } from '../useBrowserBookmarks.js';
import { useBrowserHistory } from '../useBrowserHistory.js';
import type { BrowserPinnedPage } from './browserPinnedPages.js';
import { useBrowserPinnedPages } from './useBrowserPinnedPages.js';
import { BrowserQuickLinkIcon, useWebsiteFaviconLoader } from './BrowserQuickLinkIcon.js';
import type { WebsiteFaviconLoader } from './websiteFaviconLoader.js';
import './quick-links.css';

const maxRecentHistoryEntries = 20;

export function BrowserQuickLinks({ onNavigate, onError, getWebsiteFavicon, translate: t }: {
  onNavigate(url: string): void;
  onError(message: string): void;
  getWebsiteFavicon?: BrowserDesktopBridge['getWebsiteFavicon'];
  translate: BrowserTranslate;
}) {
  const bookmarks = useBrowserBookmarks();
  const history = useBrowserHistory();
  const recentPages = history.entries.slice(0, maxRecentHistoryEntries);
  const pins = useBrowserPinnedPages();
  const faviconLoader = useWebsiteFaviconLoader(getWebsiteFavicon);
  const pinnedUrls = useMemo(() => new Set(pins.pages.map((page) => page.url)), [pins.pages]);
  const bookmarkPages = useMemo(() => {
    const seen = new Set<string>();
    return bookmarks.entries.filter((page) => {
      if (seen.has(page.url)) return false;
      seen.add(page.url);
      return true;
    });
  }, [bookmarks.entries]);
  const togglePin = (page: BrowserPinnedPage) => {
    if (!pins.toggle(page)) onError(t('feature.browser.shortcuts.saveFailed'));
  };
  const shared = { onNavigate, onTogglePin: togglePin, pinnedUrls, faviconLoader, translate: t };
  return <div className="browser-quick-links">
    {pins.pages.length ? <PageSection {...shared} title={t('feature.browser.shortcuts.pinned')} pages={pins.pages} /> : null}
    <PageSection {...shared} title={t('feature.browser.bookmarksTitle')} pages={bookmarkPages} />
    <PageSection {...shared} title={t('feature.browser.historyTitle')} pages={recentPages} />
  </div>;
}

function PageSection({ title, pages, pinnedUrls, faviconLoader, onNavigate, onTogglePin, translate: t }: {
  title: string;
  pages: readonly BrowserPinnedPage[];
  pinnedUrls: ReadonlySet<string>;
  faviconLoader: WebsiteFaviconLoader | null;
  onNavigate(url: string): void;
  onTogglePin(page: BrowserPinnedPage): void;
  translate: BrowserTranslate;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const visiblePages = expanded ? pages : pages.slice(0, 8);
  const toggleLabel = t(expanded ? 'feature.browser.shortcuts.collapse' : 'feature.browser.shortcuts.more');
  return <section className="browser-quick-links__section" aria-labelledby={id}>
    <div className="browser-quick-links__header">
      <h2 id={id}>{title}</h2>
      {pages.length > 8 ? <Button variant="ghost" className="browser-quick-links__more"
        aria-label={`${toggleLabel} · ${title}`} aria-expanded={expanded} aria-controls={`${id}-pages`}
        onClick={() => setExpanded((value) => !value)}>
        {toggleLabel}
        {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </Button> : null}
    </div>
    <ul id={`${id}-pages`} className="browser-quick-links__grid">
      {visiblePages.map((page) => {
        const pinned = pinnedUrls.has(page.url);
        const pinLabel = t(pinned ? 'feature.browser.shortcuts.unpin' : 'feature.browser.shortcuts.pin');
        return <li key={page.url}>
          <Tooltip title={page.url}>
            <Button variant="ghost" className="browser-quick-links__page"
              aria-label={`${t('feature.browser.historyOpen')} ${page.title}`} onClick={() => onNavigate(page.url)}>
              <BrowserQuickLinkIcon url={page.url} loader={faviconLoader} />
              <span className="browser-quick-links__title">{page.title}</span>
            </Button>
          </Tooltip>
          <IconButton className="browser-quick-links__pin" label={`${pinLabel} ${page.title}`} title={pinLabel}
            aria-pressed={pinned} onClick={() => onTogglePin(page)}>
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </IconButton>
        </li>;
      })}
    </ul>
  </section>;
}
