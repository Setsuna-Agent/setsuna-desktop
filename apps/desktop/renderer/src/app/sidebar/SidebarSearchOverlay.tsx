import type { RuntimeThread, RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
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
import { createPortal } from 'react-dom';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function SidebarSearchOverlay({
  projects,
  query,
  returnFocusRef,
  threads,
  onChange,
  onClose,
  onLoadThread,
  onSelect,
}: {
  projects: WorkspaceProject[];
  query: string;
  returnFocusRef: RefObject<HTMLButtonElement>;
  threads: RuntimeThreadSummary[];
  onChange: (value: string) => void;
  onClose: () => void;
  onLoadThread: (threadId: string) => Promise<RuntimeThread>;
  onSelect: (threadId: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [detailsByThreadId, setDetailsByThreadId] = useState<Record<string, RuntimeThread>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const loadingThreadIdsRef = useRef<Set<string>>(new Set());
  const hasKeyword = Boolean(query.trim());
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const candidates = threads.map((thread) => {
      const cachedDetail = detailsByThreadId[thread.id];
      const detail = cachedDetail?.updatedAt === thread.updatedAt ? cachedDetail : undefined;
      const title = compactSearchText(thread.title);
      const preview = compactSearchText(thread.lastMessagePreview);
      const messageText = detail ? compactSearchText(detail.messages.map((message) => message.content).filter(Boolean).join(' ')) : preview;
      const titleText = title.toLowerCase();
      const messageSearchText = messageText.toLowerCase();
      const titleStartsWithKeyword = Boolean(keyword && titleText.startsWith(keyword));
      const titleIncludesKeyword = Boolean(keyword && titleText.includes(keyword));
      const messageIncludesKeyword = Boolean(keyword && messageSearchText.includes(keyword));
      return {
        isBusy: Boolean(detail?.messages.some((message) => message.status === 'streaming')),
        thread,
        sourceLabel: thread.projectId ? projectNameById.get(thread.projectId) ?? t('sidebar.projectFallback') : 'agent',
        matchText: keyword && messageIncludesKeyword ? buildSearchSnippet(messageText, keyword) : undefined,
        rank: !keyword ? 3 : titleStartsWithKeyword ? 0 : titleIncludesKeyword ? 1 : messageIncludesKeyword ? 2 : 9,
        timestamp: Date.parse(thread.updatedAt || thread.createdAt || '') || 0,
      };
    });
    return candidates
      .filter((item) => !keyword || item.rank < 9)
      .sort((a, b) => a.rank - b.rank || b.timestamp - a.timestamp)
      .slice(0, 30);
  }, [detailsByThreadId, projectNameById, query, t, threads]);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    // 最近对话只需要摘要数据。仅在实际执行关键词搜索时加载完整记录，
    // 让弹出层保持轻量。
    if (!hasKeyword) {
      setDetailsLoading(false);
      return undefined;
    }
    let cancelled = false;
    const missingThreads = threads.filter((thread) => {
      const detail = detailsByThreadId[thread.id];
      return detail?.updatedAt !== thread.updatedAt && !loadingThreadIdsRef.current.has(thread.id);
    });
    if (!missingThreads.length) {
      setDetailsLoading(false);
      return undefined;
    }
    missingThreads.forEach((thread) => loadingThreadIdsRef.current.add(thread.id));
    setDetailsLoading(true);

    hydrateThreadDetails(missingThreads, onLoadThread, (thread) => {
      if (cancelled) return;
      setDetailsByThreadId((current) => ({ ...current, [thread.id]: thread }));
    })
      .catch(() => undefined)
      .finally(() => {
        missingThreads.forEach((thread) => loadingThreadIdsRef.current.delete(thread.id));
        if (!cancelled) setDetailsLoading(loadingThreadIdsRef.current.size > 0);
      });

    return () => {
      cancelled = true;
    };
  }, [detailsByThreadId, hasKeyword, onLoadThread, threads]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(results.length - 1, 0)));
  }, [results.length]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        returnFocusRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      ).filter((item) => item.offsetParent !== null || item === document.activeElement);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, returnFocusRef]);

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
  return createPortal(
    <div
      className="desktop-agent-search-overlay"
      role="presentation"
      onMouseDown={() => {
        onClose();
        returnFocusRef.current?.focus();
      }}
    >
      <div
        className="desktop-agent-search-popover"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('sidebar.searchDialog')}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="desktop-agent-search-popover__input">
          <Search size={15} />
          <input
            ref={inputRef}
            aria-activedescendant={activeResultId}
            aria-controls="desktop-agent-search-results"
            autoFocus
            value={query}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t('sidebar.searchDialog')}
          />
        </div>
        <div className="desktop-agent-search-popover__heading">
          <span>{hasKeyword ? t('sidebar.searchResults') : t('sidebar.recentChats')}</span>
          {detailsLoading && hasKeyword ? (
            <span className="desktop-agent-search-popover__loading" aria-label={t('sidebar.indexing')}>
              <LoaderCircle className="is-spinning" size={13} />
            </span>
          ) : null}
        </div>
        <div id="desktop-agent-search-results" className="desktop-agent-search-popover__list" role="listbox">
          {results.length ? (
            results.map((result, index) => (
              <button
                className={`desktop-agent-search-result ${index === activeIndex ? 'is-active' : ''}`}
                id={`desktop-agent-search-result-${index}`}
                key={result.thread.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
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
              </button>
            ))
          ) : (
            <div className="desktop-agent-search-popover__empty">
              {detailsLoading && hasKeyword ? t('sidebar.indexingContent') : hasKeyword ? t('sidebar.noResults') : t('sidebar.noRecentChats')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function compactSearchText(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildSearchSnippet(text: string, keyword: string) {
  if (!text) return '';
  const index = text.toLowerCase().indexOf(keyword);
  if (index < 0) return text.slice(0, 90);
  const start = Math.max(0, index - 22);
  const end = Math.min(text.length, index + keyword.length + 52);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

async function hydrateThreadDetails(
  threads: RuntimeThreadSummary[],
  loadThread: (threadId: string) => Promise<RuntimeThread>,
  onThreadLoaded: (thread: RuntimeThread) => void,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, threads.length) }, async () => {
    while (cursor < threads.length) {
      const thread = threads[cursor];
      cursor += 1;
      const detail = await loadThread(thread.id);
      onThreadLoaded(detail);
    }
  });
  await Promise.all(workers);
}
