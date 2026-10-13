import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { hasThreadReferenceDrag, readThreadReferenceDrag } from '../../../shared/lib/threadReferenceDrag.js';
import { createTextSlot, createThreadMentionSlot, getChatComposerSlotReference } from './chatComposerSlots.js';
import type { ComposerEditor } from './editor/types.js';

export function useChatThreadDrop({ disabled, getEditor }: {
  disabled: boolean;
  getEditor(): ComposerEditor | null;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const reset = useCallback(() => {
    depth.current = 0;
    setOver(false);
  }, []);
  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);
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
    active: over && !disabled,
    handlers: {
      onDragEnter(event: DragEvent<HTMLDivElement>) {
        if (!hasThreadReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(!disabled);
      },
      onDragOver(event: DragEvent<HTMLDivElement>) {
        if (!hasThreadReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        setOver(!disabled);
      },
      onDragLeave() {
        // Entering a tag, button or icon emits a leave for its parent, but stays in the same drop surface.
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) reset();
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        if (!hasThreadReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        reset();
        const editor = getEditor();
        const thread = readThreadReferenceDrag(event.dataTransfer);
        if (disabled || !editor || !thread) return;
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
