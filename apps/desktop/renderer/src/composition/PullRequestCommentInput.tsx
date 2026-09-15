import { useLayoutEffect, useRef } from 'react';
import type { PullRequestCommentInputProps } from '@setsuna-desktop/feature-pull-requests/renderer';
import { ChatPromptInput } from '../features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../features/chat/composer/editor/types.js';

/** Adapt durable PR drafts to the conversation editor without echoing programmatic changes. */
export function PullRequestCommentInput({ value, label, placeholder, disabled, maxLength, focusRequest, footer, onChange, onSubmit }: PullRequestCommentInputProps) {
  const editor = useRef<ComposerEditor>(null);
  const synchronizing = useRef(false);
  const synchronize = (next: string) => {
    const input = editor.current;
    if (!input) return;
    const current = input.getValue().value;
    if (next === current) return;
    const previousFocus = document.activeElement;
    const selection = document.getSelection();
    const previousSelection = selection?.anchorNode && selection.focusNode ? {
      anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focus: selection.focusNode, focusOffset: selection.focusOffset,
    } : null;
    synchronizing.current = true;
    try {
      if (next.startsWith(current)) input.insert([{ type: 'text', value: next.slice(current.length) }], 'end');
      else {
        input.clear();
        if (next) input.insert([{ type: 'text', value: next }], 'end');
      }
    } finally {
      if (previousFocus !== input.inputElement) {
        if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
        // A hidden shared editor's insert changes the document-wide selection too.
        // Restore anchor/focus in order so a backward selection keeps its direction.
        if (previousSelection?.anchor.isConnected && previousSelection.focus.isConnected) {
          selection?.setBaseAndExtent(previousSelection.anchor, previousSelection.anchorOffset, previousSelection.focus, previousSelection.focusOffset);
        } else if (!previousSelection) selection?.removeAllRanges();
      }
      synchronizing.current = false;
    }
  };
  useLayoutEffect(() => { synchronize(value); }, [value]);
  useLayoutEffect(() => { if (focusRequest !== undefined) editor.current?.focus({ cursor: 'end', preventScroll: true }); }, [focusRequest]);

  return <ChatPromptInput
    ref={editor} value={value} aria-label={label} placeholder={placeholder} disabled={disabled}
    autoSize={{ minRows: 2, maxRows: 12 }} submitOn="mod-enter"
    footer={() => footer}
    onSubmit={onSubmit} onChange={(text) => {
      if (synchronizing.current || disabled) return;
      const next = text.slice(0, maxLength);
      if (next !== text) synchronize(next);
      if (next !== value) onChange(next);
    }}
  />;
}
