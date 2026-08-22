import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { LoaderCircle } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceEntryIcon } from '../../workspace/WorkspaceEntryIcon.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export function ProjectEntryCommandMenu({
  activeIndex,
  entries,
  hasProject,
  loadError,
  loading,
  onHover,
  onSelect,
}: {
  activeIndex: number;
  entries: WorkspaceEntrySearchItem[];
  hasProject: boolean;
  loadError: string;
  loading: boolean;
  onHover: (index: number) => void;
  onSelect: (entry: WorkspaceEntrySearchItem) => void;
}) {
  const { t } = useI18n();
  const activeEntry = entries[activeIndex];
  const activeEntryKey = activeEntry ? `${activeEntry.kind}:${activeEntry.path}` : null;
  const { activeOptionRef, floatingCursorRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(activeEntryKey);

  return (
    <div ref={scrollContainerRef} className="chat-command-menu chat-project-entry-command-menu" role="listbox" aria-label={t('chat.command.projectFiles')}>
      <div ref={floatingCursorRef} className="chat-command-menu__cursor" aria-hidden="true" />
      <div className="chat-command-menu__title">{t('chat.command.projectFiles')}</div>
      {!hasProject ? (
        <div className="chat-command-menu__state">{t('chat.command.chooseProject')}</div>
      ) : loading && !entries.length ? (
        <div className="chat-command-menu__state">
          <LoaderCircle className="chat-command-menu__state-icon is-spinning" size={14} />
          <span>{t('chat.command.searchingFiles')}</span>
        </div>
      ) : loadError && !entries.length ? (
        <div className="chat-command-menu__state">{loadError}</div>
      ) : entries.length ? (
        <>
          {entries.map((entry, index) => (
            <button
              ref={index === activeIndex ? activeOptionRef : undefined}
              key={`${entry.kind}-${entry.path}`}
              type="button"
              className={`chat-command-menu__item ${index === activeIndex ? 'is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(entry);
              }}
              onMouseMove={() => onHover(index)}
            >
              <WorkspaceEntryIcon className="chat-command-menu__item-icon" path={entry.path} type={entry.kind} />
              <span className="chat-command-menu__item-main">
                <span className="chat-command-menu__item-title">{entry.kind === 'directory' ? `${entry.name}/` : entry.name}</span>
                {entry.parent ? <span className="chat-command-menu__item-desc">{entry.parent}</span> : null}
              </span>
              <span className="chat-command-menu__item-scope">{entry.kind === 'directory' ? t('chat.command.folder') : t('chat.command.file')}</span>
            </button>
          ))}
          {loadError ? <div className="chat-command-menu__state">{loadError}</div> : null}
        </>
      ) : (
        <div className="chat-command-menu__state">{t('chat.command.noFiles')}</div>
      )}
    </div>
  );
}
