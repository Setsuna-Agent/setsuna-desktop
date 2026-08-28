import { ArrowUpRight, History, Star, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BrowserBookmarkEntry } from './browserBookmarks.js';
import type { BrowserHistoryEntry } from './browserHistory.js';
import { BrowserFeatureIcon } from './BrowserFeatureIcon.js';
import type { BrowserTranslate } from './messages.js';

export function BrowserHomePage({
  bookmarks,
  entries,
  onNavigate,
  onRemoveHistory,
  translate,
}: {
  bookmarks: readonly BrowserBookmarkEntry[];
  entries: readonly BrowserHistoryEntry[];
  onNavigate: (url: string) => void;
  onRemoveHistory: (url: string) => void;
  translate: BrowserTranslate;
}) {
  return (
    <main className="desktop-browser-home">
      <div className="desktop-browser-home__intro">
        <span className="desktop-browser-home__mark" aria-hidden="true">
          <History size={18} />
        </span>
        <div>
          <h1>{translate('feature.browser.homeTitle')}</h1>
          <p>{translate('feature.browser.homeDescription')}</p>
        </div>
      </div>

      <BrowserHomeSection
        emptyDescription={translate('feature.browser.bookmarksEmptyDescription')}
        emptyIcon={Star}
        emptyTitle={translate('feature.browser.bookmarksEmptyTitle')}
        entries={bookmarks.map((entry) => ({ ...entry, timestamp: entry.savedAt }))}
        id="desktop-browser-bookmarks-title"
        itemIcon={<Star size={15} />}
        onNavigate={onNavigate}
        openLabel={translate('feature.browser.historyOpen')}
        title={translate('feature.browser.bookmarksTitle')}
      />
      <BrowserHomeSection
        emptyDescription={translate('feature.browser.historyEmptyDescription')}
        emptyIcon={History}
        emptyTitle={translate('feature.browser.historyEmptyTitle')}
        entries={entries.map((entry) => ({ ...entry, timestamp: entry.visitedAt }))}
        id="desktop-browser-history-title"
        itemIcon={<BrowserFeatureIcon size={15} />}
        onNavigate={onNavigate}
        openLabel={translate('feature.browser.historyOpen')}
        removeLabel={translate('feature.browser.historyDelete')}
        onRemove={onRemoveHistory}
        title={translate('feature.browser.historyTitle')}
      />
    </main>
  );
}

type BrowserHomeEntry = Readonly<{
  timestamp: number;
  title: string;
  url: string;
}>;

function BrowserHomeSection({
  emptyDescription,
  emptyIcon: EmptyIcon,
  emptyTitle,
  entries,
  id,
  itemIcon,
  onNavigate,
  onRemove,
  openLabel,
  removeLabel,
  title,
}: {
  emptyDescription: string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  entries: readonly BrowserHomeEntry[];
  id: string;
  itemIcon: ReactNode;
  onNavigate: (url: string) => void;
  onRemove?: (url: string) => void;
  openLabel: string;
  removeLabel?: string;
  title: string;
}) {
  return (
    <section className="desktop-browser-home-section" aria-labelledby={id}>
      <header className="desktop-browser-home-section__header">
        <h2 id={id}>{title}</h2>
      </header>
      {entries.length > 0 ? (
        <ol className="desktop-browser-home-section__list">
          {entries.map((entry) => (
            <li className={onRemove ? 'has-action' : undefined} key={entry.url}>
              <button
                aria-label={`${openLabel} ${entry.title}`}
                className="desktop-browser-home-section__link"
                type="button"
                onClick={() => onNavigate(entry.url)}
              >
                <span className="desktop-browser-home-section__icon" aria-hidden="true">
                  {itemIcon}
                </span>
                <span className="desktop-browser-home-section__details">
                  <strong>{entry.title}</strong>
                  <span>{browserPageUrlLabel(entry.url)}</span>
                </span>
                <time dateTime={new Date(entry.timestamp).toISOString()}>
                  {formatBrowserPageTime(entry.timestamp)}
                </time>
                <ArrowUpRight aria-hidden="true" size={14} />
              </button>
              {onRemove && removeLabel ? (
                <button
                  aria-label={`${removeLabel} ${entry.title}`}
                  className="desktop-browser-home-section__action"
                  title={removeLabel}
                  type="button"
                  onClick={() => onRemove(entry.url)}
                >
                  <X aria-hidden="true" size={13} />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="desktop-browser-home-section__empty">
          <EmptyIcon aria-hidden="true" size={20} />
          <strong>{emptyTitle}</strong>
          <span>{emptyDescription}</span>
        </div>
      )}
    </section>
  );
}

function browserPageUrlLabel(rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.hostname}${path}`;
}

function formatBrowserPageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(timestamp);
}
