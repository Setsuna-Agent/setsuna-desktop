import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { FilePathBreadcrumb, FileTreeRow, FileTreeSurface } from '@setsuna-desktop/renderer-ui';
import { useState, type Ref } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useWorkspaceBreadcrumbDirectory, type SearchWorkspaceEntries } from './hooks/useWorkspaceBreadcrumbDirectory.js';
import { isWorkspaceEntryWithin, normalizeProjectTreePath } from './workspaceEntryPaths.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';

export function WorkspaceFileBreadcrumb({ workspaceKey, rootLabel, path, disabled, searchEntries, onOpenEntry }: {
  workspaceKey: string;
  rootLabel: string;
  path: string;
  disabled: boolean;
  searchEntries: SearchWorkspaceEntries;
  onOpenEntry(entry: WorkspaceEntry): void;
}) {
  const { t } = useI18n();
  return <FilePathBreadcrumb key={JSON.stringify([workspaceKey, path])} rootLabel={rootLabel} path={path}
    label={t('workspace.files.filePath')} disabled={disabled}
    renderDirectory={({ directory, selectedRef, close }) => <FileTreeSurface>
      <DirectoryEntries directory={directory} depth={0} selectedPath={normalizeProjectTreePath(path)} selectedRef={selectedRef}
        searchEntries={searchEntries} onSelect={(entry) => { close(); onOpenEntry(entry); }} />
    </FileTreeSurface>} />;
}

type DirectoryProps = {
  directory: string;
  depth: number;
  selectedPath: string;
  selectedRef: Ref<HTMLButtonElement>;
  searchEntries: SearchWorkspaceEntries;
  onSelect(entry: WorkspaceEntry): void;
};

function DirectoryEntries(props: DirectoryProps) {
  const entries = useWorkspaceBreadcrumbDirectory(props.directory, props.searchEntries);
  return <div aria-busy={entries === null}>
    {entries === null ? <span className="sd-spinner" aria-hidden="true" /> : entries.map((entry) =>
      <DirectoryEntry key={entry.path} {...props} entry={entry} />)}
  </div>;
}

function DirectoryEntry({ entry, ...props }: DirectoryProps & { entry: WorkspaceEntry }) {
  const folder = entry.type === 'directory';
  const [expanded, setExpanded] = useState(() => folder && isWorkspaceEntryWithin(props.selectedPath, entry.path));
  const selected = !folder && entry.path === props.selectedPath;
  return <div>
    <FileTreeRow depth={props.depth} label={entry.name} title={entry.path} aria-label={entry.path}
      ref={selected ? props.selectedRef : undefined} selected={selected} expanded={folder ? expanded : undefined}
      icon={folder ? undefined : <WorkspaceFileIcon path={entry.path} type="file" />}
      onClick={() => folder ? setExpanded((current) => !current) : props.onSelect(entry)} />
    {folder && expanded ? <DirectoryEntries {...props} directory={entry.path} depth={props.depth + 1} /> : null}
  </div>;
}
