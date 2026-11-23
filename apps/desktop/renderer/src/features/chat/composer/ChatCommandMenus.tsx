import { Button } from '@setsuna-desktop/renderer-ui';
import { chatDesignTitle } from '@setsuna-desktop/feature-design/contracts';
import { LoaderCircle, PanelsTopLeft } from 'lucide-react';
import { Fragment } from 'react';
import { PresetAvatar } from '../../../shared/ui/icon-avatars/PresetAvatar.js';
import { BrowserFavicon } from '../../../composition/BrowserWorkspaceFeatureBoundary.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceEntryIcon } from '../../workspace/WorkspaceEntryIcon.js';
import { chatMentionItemKey, type ChatMentionItem } from '../mentions/chatMentionItems.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export function ChatMentionCommandMenu({
  activeIndex, compact = false, items, hasProject, loadError, loading, onHover, onSelect,
}: {
  activeIndex: number;
  compact?: boolean;
  items: ChatMentionItem[];
  hasProject: boolean;
  loadError: string;
  loading: boolean;
  onHover: (index: number) => void;
  onSelect: (item: ChatMentionItem) => void;
}) {
  const { t } = useI18n();
  const activeItem = items[activeIndex];
  const { activeOptionRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(
    activeItem ? chatMentionItemKey(activeItem) : null,
  );
  const hasFiles = items.some((item) => item.kind === 'workspace');
  const showSectionTitles = items.some((item) => item.kind !== (compact ? items[0]?.kind : 'workspace'));
  return (
    <div className="chat-command-menu chat-project-entry-command-menu" role="listbox" aria-label={t('chat.command.mentions')}>
      <div ref={scrollContainerRef} className="chat-command-menu__list">
        {items.map((item, index) => {
          const design = item.kind === 'design' ? item.owner : null;
          const entry = item.kind === 'workspace' ? item.entry : null;
          const tab = item.kind === 'browser-tab' ? item.tab : null;
          const app = item.kind === 'app' ? item.app : null;
          const description = design?.directory ?? tab?.url ?? entry?.parent;
          return <Fragment key={chatMentionItemKey(item)}>
            {showSectionTitles && (index === 0 || items[index - 1].kind !== item.kind) ? (
              <div className="chat-command-menu__title">{t(design ? 'feature.design.documents' : app ? 'chat.command.apps' : tab ? 'chat.command.browserTabs' : 'chat.command.projectFiles')}</div>
            ) : null}
            <Button variant="ghost"
              ref={index === activeIndex ? activeOptionRef : undefined}
              type="button"
              className={`chat-command-menu__item ${index === activeIndex ? 'is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              title={design?.directory ?? design?.ref.path ?? app?.name ?? entry?.path ?? tab?.url}
              onMouseDown={(event) => { event.preventDefault(); onSelect(item); }}
              onMouseMove={() => onHover(index)}
            >
              {design ? <PanelsTopLeft size={15} className="chat-command-menu__item-icon" /> : app ? <PresetAvatar avatar={app.avatar} color={app.avatarColor} variant="inline" className="chat-command-menu__item-icon" />
                : entry ? <WorkspaceEntryIcon className="chat-command-menu__item-icon" path={entry.path} type={entry.kind} />
                : <span className="chat-command-menu__item-icon"><BrowserFavicon faviconUrl={tab?.faviconUrl ?? null} loading={false} /></span>}
              <span className="chat-command-menu__item-main">
                <span className="chat-command-menu__item-title">{design ? chatDesignTitle(design) : app?.name ?? (tab ? tab.title || tab.url : entry?.name)}</span>
                {description ? <span className="chat-command-menu__item-desc">{description}</span> : null}
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
