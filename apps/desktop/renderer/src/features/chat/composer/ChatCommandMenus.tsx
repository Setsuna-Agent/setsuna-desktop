import { Button } from '@setsuna-desktop/renderer-ui';
import { LoaderCircle } from 'lucide-react';
import { Fragment } from 'react';
import { BrowserFavicon } from '../../../composition/BrowserWorkspaceFeatureBoundary.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceEntryIcon } from '../../workspace/WorkspaceEntryIcon.js';
import { chatMentionItemKey, type ChatMentionItem } from '../mentions/chatMentionItems.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export function ChatMentionCommandMenu({
  activeIndex, items, hasProject, loadError, loading, onHover, onSelect,
}: {
  activeIndex: number;
  items: ChatMentionItem[];
  hasProject: boolean;
  loadError: string;
  loading: boolean;
  onHover: (index: number) => void;
  onSelect: (item: ChatMentionItem) => void;
}) {
  const { t } = useI18n();
  const activeItem = items[activeIndex];
  const { activeOptionRef, floatingCursorRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(
    activeItem ? chatMentionItemKey(activeItem) : null,
  );
  const hasFiles = items.some((item) => item.kind === 'workspace');
  const showSectionTitles = items.some((item) => item.kind === 'browser-tab');
  return (
    <div className="chat-command-menu chat-project-entry-command-menu" role="listbox" aria-label={t('chat.command.mentions')}>
      <div ref={scrollContainerRef} className="chat-command-menu__list">
        <div ref={floatingCursorRef} className="chat-command-menu__cursor" aria-hidden="true" />
        {items.map((item, index) => {
          const entry = item.kind === 'workspace' ? item.entry : null;
          const tab = item.kind === 'browser-tab' ? item.tab : null;
          return <Fragment key={chatMentionItemKey(item)}>
            {showSectionTitles && (index === 0 || items[index - 1].kind !== item.kind) ? (
              <div className="chat-command-menu__title">{t(tab ? 'chat.command.browserTabs' : 'chat.command.projectFiles')}</div>
            ) : null}
            <Button variant="ghost"
              ref={index === activeIndex ? activeOptionRef : undefined}
              type="button"
              className={`chat-command-menu__item ${index === activeIndex ? 'is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              title={entry?.path ?? tab?.url}
              onMouseDown={(event) => { event.preventDefault(); onSelect(item); }}
              onMouseMove={() => onHover(index)}
            >
              {entry ? <WorkspaceEntryIcon className="chat-command-menu__item-icon" path={entry.path} type={entry.kind} />
                : <span className="chat-command-menu__item-icon"><BrowserFavicon faviconUrl={tab?.faviconUrl ?? null} loading={false} /></span>}
              <span className="chat-command-menu__item-main">
                <span className="chat-command-menu__item-title">{tab ? tab.title || tab.url : entry?.name}</span>
                {tab?.url || entry?.parent ? <span className="chat-command-menu__item-desc">{tab?.url ?? entry?.parent}</span> : null}
              </span>
            </Button>
          </Fragment>;
        })}
        {!hasFiles && (hasProject || !items.length) ? <>
          <div className="chat-command-menu__title">{t('chat.command.projectFiles')}</div>
          <div className="chat-command-menu__state">
            {!hasProject ? t('chat.command.chooseProject') : loading ? <>
              <LoaderCircle className="chat-command-menu__state-icon is-spinning" size={14} />
              <span>{t('chat.command.searchingFiles')}</span>
            </> : loadError || t('chat.command.noFiles')}
          </div>
        </> : hasFiles && loadError ? <div className="chat-command-menu__state">{loadError}</div> : null}
      </div>
    </div>
  );
}
