import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { hasThreadReferenceDrag, readThreadReferenceDrag } from '../../../shared/lib/threadReferenceDrag.js';
import { hasFileDrop, readDroppedFiles } from '../../../shared/lib/fileDrop.js';
import { createTextSlot, createThreadMentionSlot, getChatComposerSlotReference } from './chatComposerSlots.js';
import type { ComposerEditor } from './editor/types.js';

type DropKind = 'file' | 'thread';

function dropKind(data: DataTransfer): DropKind | null {
  if (hasFileDrop(data)) return 'file';
  return hasThreadReferenceDrag(data) ? 'thread' : null;
}

export function useChatComposerDrop({ disabled, filesDisabled, getEditor, onFiles }: {
  disabled: boolean;
  filesDisabled: boolean;
  getEditor(): ComposerEditor | null;
  onFiles(files: File[]): void;
}) {
  const [over, setOver] = useState<DropKind | null>(null);
  const depth = useRef(0);
  const reset = useCallback(() => {
    depth.current = 0;
    setOver(null);
  }, []);
  useEffect(() => {
    if (disabled || (over === 'file' && filesDisabled)) reset();
  }, [disabled, filesDisabled, over, reset]);
  useEffect(() => {
    if (!over) return;
    const ownerWindow = getEditor()?.inputElement?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    ownerWindow.addEventListener('dragend', reset, true);
    ownerWindow.addEventListener('drop', reset, true);
    ownerWindow.addEventListener('blur', reset);
    return () => {
      ownerWindow.removeEventListener('dragend', reset, true);
      ownerWindow.removeEventListener('drop', reset, true);
      ownerWindow.removeEventListener('blur', reset);
    };
  }, [getEditor, over, reset]);

  return {
    active: Boolean(over && !disabled && (over !== 'file' || !filesDisabled)),
    handlers: {
      onDragEnter(event: DragEvent<HTMLDivElement>) {
        const kind = dropKind(event.dataTransfer);
        if (!kind) return;
        event.preventDefault();
        depth.current += 1;
        setOver(disabled || (kind === 'file' && filesDisabled) ? null : kind);
      },
      onDragOver(event: DragEvent<HTMLDivElement>) {
        const kind = dropKind(event.dataTransfer);
        if (!kind) return;
        event.preventDefault();
        const blocked = disabled || (kind === 'file' && filesDisabled);
        event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
        setOver(blocked ? null : kind);
      },
      onDragLeave() {
        // Entering a tag, button or icon emits a leave for its parent, but stays in the same drop surface.
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) reset();
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        const kind = dropKind(event.dataTransfer);
        if (!kind) return;
        event.preventDefault();
        event.stopPropagation();
        reset();
        const editor = getEditor();
        if (disabled || !editor) return;
        if (kind === 'file') {
          if (filesDisabled) return;
          // Read File objects synchronously while the drop data store is still accessible.
          const files = readDroppedFiles(event.dataTransfer);
          if (files.length) {
            onFiles(files);
            editor.focus({ preventScroll: true });
          }
          return;
        }
        const thread = readThreadReferenceDrag(event.dataTransfer);
        if (!thread) return;
        const { value, slotConfig } = editor.getValue();
        if (slotConfig.some((slot) => {
          const reference = getChatComposerSlotReference(slot);
          return reference?.type === 'thread' && reference.thread.id === thread.id;
        })) return;
        // A sidebar drag leaves the editor's selection stale. Append without replacing selected draft text.
        editor.insert([
          ...(value && !/\s$/u.test(value) ? [createTextSlot(' ')] : []),
          createThreadMentionSlot(thread), createTextSlot(' '),
        ], 'end');
        editor.focus({ cursor: 'end', preventScroll: true });
      },
    },
  };
}
