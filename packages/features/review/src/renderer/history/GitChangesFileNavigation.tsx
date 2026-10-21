import { Dock, DockItem, DockSeparator, Dropdown, FileTreeToggle, IconButton, TextField, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { ChevronLeft, ChevronRight, Files, Search } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { ReviewIconButton } from '../primitives.js';
import { ReviewChangeCounts } from '../ReviewChangeCounts.js';
import { ReviewFileIcon } from '../ReviewFileVisuals.js';
import { reviewFilePathParts } from '../review-paths.js';
import type { ReviewPathContext } from '../review-types.js';
import { GitChangesFileActions } from './GitChangesFileActions.js';
import type { GitChangesFileGroup } from './GitChangesFiles.js';
import type { GitHistoryFileActions } from './GitHistoryDiff.js';

/** Compact navigation shares the sidebar's group/path identity, including staged duplicates. */
export function GitChangesFileNavigation({ groups, selectedKey, sidebarExpanded, pathContext, actions, viewControls, onSelect, onToggleSidebar }: {
  groups: GitChangesFileGroup[];
  selectedKey: string | null;
  sidebarExpanded: boolean;
  pathContext: ReviewPathContext;
  actions: GitHistoryFileActions;
  viewControls?: ReactNode;
  onSelect: (group: string, file: DesktopGitChangedFile) => void;
  onToggleSidebar: () => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpenOnLeave = useRef(false);
  const entries = groups.flatMap((group) => group.files.map((file) => ({ group: group.id, file, key: group.id + ':' + file.path })));
  const index = entries.findIndex((entry) => entry.key === selectedKey);
  const previous = entries[index - 1];
  const next = entries[index + 1];

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => clearHoverTimer, []);

  const changeOpen = (value: boolean) => {
    clearHoverTimer();
    setOpen(value);
    if (!value) {
      keepOpenOnLeave.current = false;
      setQuery('');
    }
  };
  const keepOpen = () => {
    keepOpenOnLeave.current = true;
    clearHoverTimer();
  };
  const leave = () => {
    clearHoverTimer();
    if (!keepOpenOnLeave.current) hoverTimer.current = setTimeout(() => changeOpen(false), 180);
  };
  const select = (entry: typeof entries[number]) => {
    changeOpen(false);
    onSelect(entry.group, entry.file);
  };
  const filter = query.trim().toLocaleLowerCase();
  // Search only narrows the picker; previous/next keep the complete file order.
  const menuItems = open ? groups.flatMap<MenuItem>((group) => {
    const files = group.files.filter((file) => !filter || file.path.toLocaleLowerCase().includes(filter));
    if (!files.length) return [];
    return [{
      key: group.id,
      type: 'group',
      label: group.label,
      children: files.map((file) => {
        const { filename, directory } = reviewFilePathParts(file.path);
        return {
          key: group.id + ':' + file.path,
          extra: false, // The row background indicates selection without a trailing icon.
          icon: <ReviewFileIcon path={file.path} />,
          label: <span className="git-changes-file-navigation__file" title={file.path}>
            <span className="git-changes-file-navigation__file-heading">
              <span className="git-changes-file-navigation__filename">{filename}</span>
              <ReviewChangeCounts additions={file.additions} deletions={file.deletions} />
            </span>
            {directory ? <span className="git-changes-file-navigation__directory">{directory.slice(0, -1)}</span> : null}
          </span>,
          onClick: () => { changeOpen(false); onSelect(group.id, file); },
        };
      }),
    }];
  }) : [];

  return (
    <nav className="git-changes-file-navigation" aria-label={t('feature.review.history.fileNavigation')}>
      <Dock size={32} className="git-changes-file-navigation__dock">
        <DockItem>
          <ReviewIconButton tooltip tooltipPlacement="top" label={t('feature.review.history.previousFile')} disabled={!previous} onClick={() => { if (previous) select(previous); }}>
            <ChevronLeft size={16} />
          </ReviewIconButton>
        </DockItem>
        <DockItem>
          <ReviewIconButton tooltip tooltipPlacement="top" label={t('feature.review.history.nextFile')} disabled={!next} onClick={() => { if (next) select(next); }}>
            <ChevronRight size={16} />
          </ReviewIconButton>
        </DockItem>
        <DockItem>
          <Dropdown
            placement="top"
            rootClassName="git-changes-file-navigation__menu sd-menu-surface--neutral"
            disabled={!entries.length}
            open={open && entries.length > 0}
            onOpenChange={changeOpen}
            initialFocusRef={searchRef}
            menu={{
              items: menuItems.length ? menuItems : [{ key: 'empty', disabled: true, label: t('feature.review.workspace.fileBrowser.noMatch') }],
              selectedKeys: selectedKey ? [selectedKey] : [],
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'touch' || !entries.length) return;
              clearHoverTimer();
              hoverTimer.current = setTimeout(() => changeOpen(true), 150);
            }}
            onPointerLeave={leave}
            onKeyDownCapture={keepOpen}
            popupRender={(menu) => (
              <div className="git-changes-file-navigation__picker" onPointerEnter={clearHoverTimer} onPointerLeave={leave}
                onKeyDownCapture={keepOpen}>
                <div className="git-changes-file-navigation__search">
                  <TextField ref={searchRef} appearance="search" leadingIcon={<Search size={13} />}
                    aria-label={t('feature.review.history.searchFiles')} placeholder={t('feature.review.history.searchFiles')}
                    value={query} onChange={(event) => setQuery(event.target.value)}
                    onPointerDown={keepOpen} onKeyDown={handleFileSearchKeyDown} />
                </div>
                <div className="git-changes-file-navigation__list">{menu}</div>
              </div>
            )}
          >
            <IconButton label={t('feature.review.history.fileList')} title="" disabled={!entries.length}>
              <Files size={16} />
            </IconButton>
          </Dropdown>
        </DockItem>
        <GitChangesFileActions key={selectedKey} file={entries[index]?.file ?? null}
          pathContext={pathContext} actions={actions} onOpenMenu={() => changeOpen(false)} />
        {viewControls}
        <DockSeparator className="git-changes-file-navigation__separator" />
        <DockItem>
          <FileTreeToggle tooltip expanded={sidebarExpanded}
            label={t(sidebarExpanded ? 'feature.review.history.collapseSidebar' : 'feature.review.history.expandSidebar')}
            onToggle={() => { changeOpen(false); onToggleSidebar(); }} />
        </DockItem>
      </Dock>
    </nav>
  );
}

function handleFileSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  // Keep typing and IME input out of menu typeahead, while retaining row navigation.
  if (event.key === 'Escape') return;
  event.stopPropagation();
  if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) return;
  event.preventDefault();
  const rows = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])');
  const last = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
  const row = last ? rows?.[rows.length - 1] : rows?.[0];
  if (event.key === 'Enter') row?.click();
  else row?.focus();
}
