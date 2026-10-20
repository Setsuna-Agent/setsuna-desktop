import { useLayoutEffect, useRef } from 'react';
import type { PullRequestCommentInputProps, PullRequestQuoteReference } from '@setsuna-desktop/feature-pull-requests/renderer';
import { ChatPromptInput } from '../features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../features/chat/composer/editor/types.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { commentQuotes, commentSlots, removeCommentQuote, sameQuotes } from './pull-requests/commentSlots.js';

const noQuotes: PullRequestQuoteReference[] = [];

/** Adapt durable PR drafts to the conversation editor without echoing programmatic changes. */
export function PullRequestCommentInput({ value, quotes = noQuotes, label, placeholder, disabled, maxLength, focusRequest, footer, onChange, onSubmit }: PullRequestCommentInputProps) {
  const { t } = useI18n();
  const editor = useRef<ComposerEditor>(null);
  const synchronizing = useRef(false);
  const previousDisabled = useRef(disabled);
  const actions = useRef({ disabled, onChange });
  actions.current = { disabled, onChange };
  const emit = (next: string, references: PullRequestQuoteReference[]) => {
    if (references.length) actions.current.onChange(next, references);
    else actions.current.onChange(next);
  };
  const removeQuote = (id: string) => {
    const input = editor.current;
    if (!input || actions.current.disabled) return;
    const current = input.getValue();
    const next = removeCommentQuote(current.value, commentQuotes(current.slotConfig), id);
    if (!next) return;
    emit(next.value, next.quotes);
    input.focus({ cursor: 'end', preventScroll: true });
  };
  const synchronize = (next: string, references = quotes) => {
    const input = editor.current;
    if (!input) return;
    const current = input.getValue();
    if (next === current.value && sameQuotes(commentQuotes(current.slotConfig), references) && previousDisabled.current === disabled) return;
    previousDisabled.current = disabled;
    const previousFocus = document.activeElement;
    const selection = document.getSelection();
    const previousSelection = selection?.anchorNode && selection.focusNode ? {
      anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focus: selection.focusNode, focusOffset: selection.focusOffset,
    } : null;
    synchronizing.current = true;
    try {
      if (!references.length && !commentQuotes(current.slotConfig).length && next.startsWith(current.value)) {
        input.insert([{ type: 'text', value: next.slice(current.value.length) }], 'end');
      }
      else {
        input.clear();
        if (next) input.insert(commentSlots(next, references, t('feature.pullRequests.removeQuote'), disabled, removeQuote), 'end');
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
  useLayoutEffect(() => { synchronize(value); }, [value, quotes, disabled]);
  useLayoutEffect(() => {
    if (focusRequest === undefined) return;
    editor.current?.focus({ cursor: 'end', preventScroll: true });
    editor.current?.inputElement?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);

  return <ChatPromptInput
    ref={editor} value={value} slotConfig={commentSlots(value, quotes, t('feature.pullRequests.removeQuote'), disabled, removeQuote)}
    aria-label={label} placeholder={placeholder} disabled={disabled}
    autoSize={{ minRows: 2, maxRows: 12 }} submitOn="mod-enter"
    footer={() => footer}
    onSubmit={onSubmit} onChange={(text, _event, slots = []) => {
      if (synchronizing.current || disabled) return;
      const references = commentQuotes(slots);
      // Never leave half a serialized quote behind when enforcing GitHub's comment limit.
      const crossing = references.find((quote) => quote.start < maxLength && quote.end > maxLength);
      const next = text.slice(0, crossing?.start ?? maxLength);
      const retained = references.filter((quote) => quote.end <= next.length);
      if (next !== text) synchronize(next, retained);
      if (next !== value || !sameQuotes(retained, quotes)) emit(next, retained);
    }}
  />;
}
