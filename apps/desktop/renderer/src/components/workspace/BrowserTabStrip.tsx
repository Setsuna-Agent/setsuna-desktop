import { memo } from 'react';
import { BrowserFavicon } from './BrowserFavicon.js';

export type BrowserTabHeaderItem = {
  faviconUrl: string | null;
  id: string;
  loading: boolean;
  title: string;
};

export const BrowserTabStrip = memo(function BrowserTabStrip({
  activeTabId,
  onCloseTab,
  onSelectTab,
  tabs,
}: {
  activeTabId: string;
  onCloseTab: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  tabs: readonly BrowserTabHeaderItem[];
}) {
  return (
    <span className="desktop-browser-tabs" role="tablist" aria-label="浏览器标签页">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <span
            className={[
              'chat-file-review-panel__title',
              'chat-file-review-panel__title--closable',
              'desktop-browser-tab',
              active ? 'chat-file-review-panel__title--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={tab.id}
          >
            <button
              aria-selected={active}
              className="chat-file-review-panel__tab-button desktop-browser-tab__select"
              role="tab"
              tabIndex={active ? 0 : -1}
              title={tab.title}
              type="button"
              onClick={() => onSelectTab(tab.id)}
            >
              <BrowserFavicon faviconUrl={tab.faviconUrl} loading={tab.loading} />
              <span className="chat-file-review-panel__tab-label">{tab.title}</span>
            </button>
            <button
              aria-label={`关闭${tab.title}`}
              className="chat-file-review-panel__tab-close desktop-browser-tab__close"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <span className="chat-file-review-panel__tab-close-glyph" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </span>
  );
});
