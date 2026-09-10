import { TextField, Dialog, Button } from '@setsuna-desktop/renderer-ui';

import type { DesktopRuntimeClient, RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { LoaderCircle, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue.js';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { buildSidebarSearchResults } from './sidebarSearchResults.js';

export function SidebarSearchOverlay({
  projects,
  query,
  returnFocusRef,
  threads,
  onChange,
  onClose,
  onSearchThreads,
  onSelect,
}: {
  projects: WorkspaceProject[];
  query: string;
  returnFocusRef: RefObject<HTMLButtonElement>;
  threads: RuntimeThreadSummary[];
  onChange: (value: string) => void;
  onClose: () => void;
  onSearchThreads: DesktopRuntimeClient['listThreads'];
  onSelect: (threadId: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [matchingThreads, setMatchingThreads] = useState<RuntimeThreadSummary[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 200);
  const searchRequests = useIdentityRequestGuard(normalizedQuery || 'recent-threads');
  const hasKeyword = Boolean(normalizedQuery);
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const results = useMemo(() => buildSidebarSearchResults({
    projectFallback: t('sidebar.projectFallback'),
    projectNameById,
    query,
    threads: hasKeyword ? matchingThreads : threads,
  }), [hasKeyword, matchingThreads, projectNameById, query, t, threads]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!normalizedQuery) {
      setMatchingThreads([]);
      setSearchLoading(false);
      return undefined;
    }
    if (debouncedQuery !== normalizedQuery) {
      setMatchingThreads([]);
      setSearchLoading(true);
      return undefined;
    }
    const isCurrentRequest = searchRequests.begin();
    setSearchLoading(true);
    onSearchThreads({ search: debouncedQuery })
      .then((result) => {
        if (isCurrentRequest()) setMatchingThreads(result.threads);
      })
      .catch(() => {
        if (isCurrentRequest()) setMatchingThreads([]);
      })
      .finally(() => {
        if (isCurrentRequest()) setSearchLoading(false);
      });
    return undefined;
  }, [debouncedQuery, normalizedQuery, onSearchThreads, searchRequests]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const openResult = useCallback((threadId: string) => {
    onSelect(threadId);
    returnFocusRef.current?.focus();
  }, [onSelect, returnFocusRef]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      const activeResult = results[activeIndex] ?? results[0];
      if (!activeResult) return;
      event.preventDefault();
      openResult(activeResult.thread.id);
    }
  };

  const activeResultId = results[activeIndex] ? `desktop-agent-search-result-${activeIndex}` : undefined;
  return (
    <Dialog aria-label={t('sidebar.searchDialog')} showClose={false} width={600}
      className="desktop-agent-search-popover" onClose={onClose}>
        <div className="desktop-agent-search-popover__input">
          <Search size={15} />
          <TextField
            ref={inputRef}
            aria-activedescendant={activeResultId}
            aria-autocomplete="list"
            aria-controls="desktop-agent-search-results"
            aria-expanded="true"
            aria-haspopup="listbox"
            autoFocus
            role="combobox"
            value={query}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t('sidebar.searchDialog')}
          />
        </div>
        <div className="desktop-agent-search-popover__heading">
          <span>{hasKeyword ? t('sidebar.searchResults') : t('sidebar.recentChats')}</span>
          {searchLoading && hasKeyword ? (
            <span className="desktop-agent-search-popover__loading" aria-label={t('sidebar.indexing')}>
              <LoaderCircle className="is-spinning" size={13} />
            </span>
          ) : null}
        </div>
        <div
          id="desktop-agent-search-results"
          className="desktop-agent-search-popover__list"
          role="listbox"
          aria-busy={searchLoading}
        >
          {results.length ? (
            results.map((result, index) => (
              <Button variant="ghost"
                className={`desktop-agent-search-result ${index === activeIndex ? 'is-active' : ''}`}
                id={`desktop-agent-search-result-${index}`}
                key={result.thread.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                title={result.thread.title}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResult(result.thread.id)}
              >
                <span className="desktop-agent-search-result__status">
                  {result.isBusy ? <LoaderCircle className="is-spinning" size={13} /> : null}
                </span>
                <span className="desktop-agent-search-result__main">
                  <span className="desktop-agent-search-result__title">{result.thread.title}</span>
                  {result.matchText ? <span className="desktop-agent-search-result__match">{result.matchText}</span> : null}
                </span>
                <span className="desktop-agent-search-result__source">{result.sourceLabel}</span>
              </Button>
            ))
          ) : (
            <div className="desktop-agent-search-popover__empty">
              {searchLoading && hasKeyword ? t('sidebar.indexingContent') : hasKeyword ? t('sidebar.noResults') : t('sidebar.noRecentChats')}
            </div>
          )}
        </div>
    </Dialog>
  );
}
