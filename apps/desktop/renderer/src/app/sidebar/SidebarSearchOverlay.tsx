import { Button, Dialog, FileIcon, TextField } from '@setsuna-desktop/renderer-ui';
import { workspaceProjectRoots, type DesktopRuntimeClient, type RuntimeThreadSummary, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { FileText, LoaderCircle, MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutHint } from '../../shared/ui/ShortcutTooltip.js';
import { runtimeClientErrorMessage } from '../../services/runtime-client/runtimeClientErrors.js';
import { useToast } from '../providers/ToastProvider.js';
import { SidebarSearchFilters } from './SidebarSearchFilters.js';
import { useSidebarSearch } from './useSidebarSearch.js';
import { filterSidebarSearchActions, useSidebarSearchActions, type SidebarSearchActionHandlers } from './useSidebarSearchActions.js';
import type { SidebarSearchCategory, SidebarSearchFileTarget } from './sidebarSearchTypes.js';

type SearchRow = {
  id: string;
  group: Exclude<SidebarSearchCategory, 'all'>;
  title: string;
  source?: string;
  preview?: string;
  tooltip?: string;
  icon: ReactNode;
  shortcut?: ReactNode;
  select(): void | Promise<unknown>;
};

export function SidebarSearchOverlay({
  actions, activeProjectId, client, initialCategory = 'all', projects, query, threads, onChange, onClose, onSelectThread, onSelectFile,
}: {
  actions: SidebarSearchActionHandlers;
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  initialCategory?: SidebarSearchCategory;
  projects: WorkspaceProject[];
  query: string;
  threads: RuntimeThreadSummary[];
  onChange(value: string): void;
  onClose(): void;
  onSelectThread(threadId: string): void | Promise<unknown>;
  onSelectFile(target: SidebarSearchFileTarget): void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<SidebarSearchCategory>(initialCategory);
  const [projectId, setProjectId] = useState(activeProjectId);
  const [extensions, setExtensions] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const fileProjects = projects.filter((project) => workspaceProjectRoots(project).length > 0);
  const project = fileProjects.find((item) => item.id === projectId) ?? fileProjects[0];
  const catalog = useSidebarSearchActions(actions);
  const results = useSidebarSearch({ client, category, extensions, project, projects, query, threads });
  const all = category === 'all';
  const matches = filterSidebarSearchActions(catalog, query);
  const rows: SearchRow[] = [
    ...(all || category === 'actions' ? matches.slice(0, all ? (query.trim() ? 6 : 2) : undefined).map((action): SearchRow => ({
      ...action, group: 'actions', select: action.run, shortcut: action.shortcut ? <ShortcutHint commandId={action.shortcut} /> : undefined,
    })) : []),
    ...results.threads.slice(0, all ? 8 : undefined).map((result): SearchRow => ({
      id: `thread:${result.thread.id}`, group: 'threads', title: result.thread.title, source: result.sourceLabel, preview: result.matchText,
      icon: result.isBusy ? <LoaderCircle className="is-spinning" size={14} /> : <MessageCircle size={14} />,
      select: () => onSelectThread(result.thread.id),
    })),
    ...[...results.files.slice(0, all ? 8 : undefined), ...results.text.slice(0, all ? 8 : undefined)].map((result): SearchRow => ({
      ...result, group: result.kind,
      source: result.kind === 'text' ? `${result.target.path.split('/').at(-1)}:${result.target.line}` : result.source,
      tooltip: `${result.title}\n${result.source}`,
      icon: result.kind === 'files' ? <FileIcon path={result.target.path} /> : <FileText size={14} />,
      select: () => onSelectFile(result.target),
    })),
  ];

  useEffect(() => setActiveIndex(0), [query, category, project?.id, extensions]);
  useEffect(() => inputRef.current?.focus(), []);
  const selectedIndex = Math.min(activeIndex, Math.max(0, rows.length - 1));
  const activeResultId = rows.length ? `desktop-agent-search-result-${selectedIndex}` : undefined;
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, category, rows.length]);

  const select = (row: SearchRow) => {
    onClose();
    onChange('');
    void Promise.resolve().then(() => row.select()).catch((error: unknown) => toast.error(runtimeClientErrorMessage(error)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(rows.length ? (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0);
    } else if (event.key === 'Enter' && rows[selectedIndex]) {
      event.preventDefault();
      select(rows[selectedIndex]);
    }
  };
  const groupLabel = (group: SearchRow['group']) => group === 'actions' && all && !query.trim()
    ? t('search.quickActions') : t(`search.category.${group}`);

  return (
    <Dialog aria-label={t('sidebar.searchDialog')} showClose={false} width={768} className="desktop-agent-search-popover"
      onClose={onClose}>
      <div className="desktop-agent-search-popover__input">
        <TextField ref={inputRef} aria-label={t('sidebar.searchDialog')} role="combobox" autoFocus
          aria-activedescendant={activeResultId} aria-autocomplete="list" aria-controls="desktop-agent-search-results"
          aria-expanded="true" aria-haspopup="listbox" value={query} placeholder={t('sidebar.searchDialog')}
          onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
        {results.loading ? <LoaderCircle size={15} className="is-spinning" aria-label={t('common.loading')} /> : null}
      </div>
      <div id="desktop-agent-search-results" ref={listRef} className="desktop-agent-search-popover__list" role="listbox"
        aria-label={t('sidebar.searchResults')} aria-busy={results.loading}>
        {rows.map((row, index) => (
          <div key={row.id} role="presentation">
            {rows[index - 1]?.group !== row.group ? <div className="desktop-agent-search-popover__heading" role="presentation">{groupLabel(row.group)}</div> : null}
            <Button variant="ghost" className={`desktop-agent-search-result desktop-agent-search-result--${row.group}${index === selectedIndex ? ' is-active' : ''}`}
              id={`desktop-agent-search-result-${index}`} type="button" role="option" aria-selected={index === selectedIndex} tabIndex={-1}
              title={row.tooltip ?? [row.title, row.source].filter(Boolean).join(' — ')} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(row)}>
              <span className="desktop-agent-search-result__icon" aria-hidden="true">{row.icon}</span>
              <span className="desktop-agent-search-result__main">
                <span className="desktop-agent-search-result__title">{row.title}</span>
                {row.preview ? <span className="desktop-agent-search-result__match">{row.preview}</span> : null}
              </span>
              {row.source ? <span className="desktop-agent-search-result__source">{row.source}</span> : null}
              {row.shortcut}
            </Button>
          </div>
        ))}
        {!rows.length && !results.loading && !results.failed ? <div className="desktop-agent-search-popover__empty">{t('search.noResults')}</div> : null}
      </div>
      <SidebarSearchFilters category={category} projectId={project?.id ?? ''} projects={fileProjects} extensions={extensions}
        onChangeCategory={(next) => { setCategory(next); inputRef.current?.focus(); }} onChangeProject={setProjectId} onChangeExtensions={setExtensions} />
    </Dialog>
  );
}
