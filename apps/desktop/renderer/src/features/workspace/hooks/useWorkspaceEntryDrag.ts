import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import { useRef, useState, type DragEvent } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { runtimeClientErrorMessage } from '../../../services/runtime-client/runtimeClientErrors.js';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { hasFileDrop, readDroppedFiles } from '../../../shared/lib/fileDrop.js';
import { isWorkspaceEntryWithin, workspaceEntryParent } from '../workspaceEntryPaths.js';
import { useDesktopFileDrag } from './useDesktopFileDrag.js';

const ENTRY_DRAG_TYPE = 'application/x-setsuna-workspace-entry';

export function useWorkspaceEntryDrag({ projectId, workspaceRoot, disabled, entries, moveEntry, onMoved }: {
  projectId?: string;
  workspaceRoot?: string;
  disabled: boolean;
  entries: WorkspaceEntry[];
  moveEntry(entryPath: string, parentPath: string): Promise<WorkspaceEntry | null>;
  onMoved(entry: WorkspaceEntry, previousPath: string): void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const sourceRef = useRef<WorkspaceEntry | null>(null);
  const preview = useNativeDragPreview();
  const startNativeDrag = useDesktopFileDrag();
  const requests = useIdentityRequestGuard(JSON.stringify([projectId, workspaceRoot]));
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const internalDrag = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes(ENTRY_DRAG_TYPE);
  const endDrag = () => { preview.end(); sourceRef.current = null; setDraggingPath(null); setDropPath(null); };
  const startDrag = (event: DragEvent<HTMLElement>, entry: WorkspaceEntry) => {
    if (disabled || !projectId) { event.preventDefault(); return; }
    if (entry.type === 'file' && workspaceRoot && window.setsunaDesktop?.desktop.startFileDrag) {
      endDrag();
      startNativeDrag(event, { kind: 'workspace-file', workspaceRoot, filePath: entry.path });
      return;
    }
    sourceRef.current = entry;
    setDraggingPath(entry.path);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(ENTRY_DRAG_TYPE, JSON.stringify({ projectId, path: entry.path }));
    preview.start(event);
  };
  const dragOver = (event: DragEvent<HTMLElement>, parentPath: string) => {
    if (!internalDrag(event) && !hasFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const source = internalDrag(event) ? sourceRef.current : null;
    const allowed = !disabled && (!source || (workspaceEntryParent(source.path) !== parentPath
      && !(source.type === 'directory' && isWorkspaceEntryWithin(parentPath, source.path))));
    // Electron's Windows file source allows copy/link only; the tree performs its own move after drop.
    event.dataTransfer.dropEffect = allowed ? (internalDrag(event) ? 'move' : 'copy') : 'none';
    setDropPath(allowed ? parentPath : null);
  };
  const drop = async (event: DragEvent<HTMLElement>, parentPath: string) => {
    const internal = internalDrag(event);
    if (!internal && !hasFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const source = sourceRef.current;
    endDrag();
    if (disabled) return;
    const isCurrent = requests.begin();
    let entry: WorkspaceEntry | undefined;
    try {
      if (internal) {
        const payload = JSON.parse(event.dataTransfer.getData(ENTRY_DRAG_TYPE)) as { projectId?: string; path?: string };
        if (payload.projectId !== projectId || typeof payload.path !== 'string') return;
        // Resolve the payload against this workspace's current tree instead of trusting serialized entry metadata.
        entry = entries.find((item) => item.path === payload.path) ?? (source && source.path === payload.path ? source : undefined);
      } else {
        const files = readDroppedFiles(event.dataTransfer);
        if (files.length !== 1 || !workspaceRoot) return;
        const filePath = await window.setsunaDesktop?.desktop.resolveWorkspaceFileDrop(workspaceRoot, files[0]);
        // Native file drags can return to the tree. Only move an existing entry of this workspace.
        if (!isCurrent() || disabledRef.current || !filePath) return;
        entry = entries.find((item) => item.type === 'file' && item.path === filePath);
      }
    } catch { return; }
    if (!entry || workspaceEntryParent(entry.path) === parentPath) return;
    if (entry.type === 'directory' && isWorkspaceEntryWithin(parentPath, entry.path)) {
      toast.warning(t('workspace.files.moveIntoSelf'));
      return;
    }
    try {
      const moved = await moveEntry(entry.path, parentPath);
      if (moved && isCurrent()) onMoved(moved, entry.path);
    } catch (error) {
      toast.error(t('workspace.files.moveFailed', { error: runtimeClientErrorMessage(error) }));
    }
  };
  return {
    draggingPath: preview.dragging ? draggingPath : null,
    dropPath, startDrag, endDrag, dragOver,
    clearDropTarget: () => setDropPath(null),
    drop: (event: DragEvent<HTMLElement>, parentPath: string) => { void drop(event, parentPath); },
  };
}
