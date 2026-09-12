import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { useRef, useState, type DragEvent } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { runtimeClientErrorMessage } from '../../../services/runtime-client/runtimeClientErrors.js';
import { isWorkspaceEntryWithin, workspaceEntryParent } from '../workspaceEntryPaths.js';

const ENTRY_DRAG_TYPE = 'application/x-setsuna-workspace-entry';

export function useWorkspaceEntryDrag({ projectId, disabled, entries, moveEntry, onMoved }: {
  projectId?: string;
  disabled: boolean;
  entries: WorkspaceEntry[];
  moveEntry(entryPath: string, parentPath: string): Promise<WorkspaceEntry | null>;
  onMoved(entry: WorkspaceEntry, previousPath: string): void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const sourceRef = useRef<WorkspaceEntry | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const internalDrag = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes(ENTRY_DRAG_TYPE);
  const endDrag = () => { sourceRef.current = null; setDraggingPath(null); setDropPath(null); };
  const startDrag = (event: DragEvent<HTMLElement>, entry: WorkspaceEntry) => {
    if (disabled || !projectId) { event.preventDefault(); return; }
    sourceRef.current = entry;
    setDraggingPath(entry.path);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(ENTRY_DRAG_TYPE, JSON.stringify({ projectId, path: entry.path }));
  };
  const dragOver = (event: DragEvent<HTMLElement>, parentPath: string) => {
    if (!internalDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const source = sourceRef.current;
    const allowed = !disabled && (!source || (workspaceEntryParent(source.path) !== parentPath
      && !(source.type === 'directory' && isWorkspaceEntryWithin(parentPath, source.path))));
    event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    setDropPath(allowed ? parentPath : null);
  };
  const drop = async (event: DragEvent<HTMLElement>, parentPath: string) => {
    if (!internalDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const source = sourceRef.current;
    endDrag();
    if (disabled) return;
    let entry: WorkspaceEntry | undefined;
    try {
      const payload = JSON.parse(event.dataTransfer.getData(ENTRY_DRAG_TYPE)) as { projectId?: string; path?: string };
      if (payload.projectId !== projectId || typeof payload.path !== 'string') return;
      // Resolve the payload against this workspace's current tree instead of trusting serialized entry metadata.
      entry = entries.find((item) => item.path === payload.path) ?? (source && source.path === payload.path ? source : undefined);
    } catch { return; }
    if (!entry || workspaceEntryParent(entry.path) === parentPath) return;
    if (entry.type === 'directory' && isWorkspaceEntryWithin(parentPath, entry.path)) {
      toast.warning(t('workspace.files.moveIntoSelf'));
      return;
    }
    try {
      const moved = await moveEntry(entry.path, parentPath);
      if (moved) onMoved(moved, entry.path);
    } catch (error) {
      toast.error(t('workspace.files.moveFailed', { error: runtimeClientErrorMessage(error) }));
    }
  };
  return {
    draggingPath, dropPath, startDrag, endDrag, dragOver,
    clearDropTarget: () => setDropPath(null),
    drop: (event: DragEvent<HTMLElement>, parentPath: string) => { void drop(event, parentPath); },
  };
}
