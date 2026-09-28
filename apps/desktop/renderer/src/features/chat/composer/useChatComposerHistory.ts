import type { RuntimePluginSummary, RuntimeSkillSummary, RuntimeThread } from '@setsuna-desktop/contracts';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createMessageDraftSlots } from './chatComposerSlots.js';
import { isComposerSelectionAtStart } from './editor/composerDocument.js';
import type { ComposerEditor, ComposerSlot } from './editor/types.js';

type HistoryBrowse = {
  messageId: string;
  draft: ComposerSlot[];
  value: string;
};

/** Keep browsing local to this composer, including the unsent draft's structured references. */
export function useChatComposerHistory({
  currentThread, draft, disabled, getEditor, onRestore, plugins, skills,
}: {
  currentThread: RuntimeThread | null;
  draft: string;
  disabled: boolean;
  getEditor: () => ComposerEditor | null;
  onRestore: (slots: ComposerSlot[]) => void;
  plugins: readonly RuntimePluginSummary[];
  skills: RuntimeSkillSummary[];
}) {
  const browseRef = useRef<HistoryBrowse | null>(null);
  useEffect(() => { browseRef.current = null; }, [currentThread?.id]);
  useEffect(() => {
    if (browseRef.current?.value !== draft) browseRef.current = null;
  }, [draft]);

  return (event: KeyboardEvent): boolean => {
    if (disabled || event.defaultPrevented || event.nativeEvent.isComposing
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
    const editor = getEditor();
    if (!editor?.inputElement || !isComposerSelectionAtStart(editor.inputElement)) return false;
    const browse = browseRef.current;
    if (!browse && event.key !== 'ArrowUp') return false;
    const entries = (currentThread?.messages ?? []).filter((message) => message.role === 'user'
      && !message.promptSource && message.visibility !== 'model' && message.content.trim());
    if (!entries.length && !browse) return false;
    // Re-resolve the selected message in the live window so prepended pages are
    // immediately reachable without shifting the user's current history position.
    const selectedIndex = browse ? entries.findIndex((message) => message.id === browse.messageId) : -1;
    const index = selectedIndex < 0 ? entries.length : selectedIndex;
    const nextIndex = Math.max(0, Math.min(entries.length, index + (event.key === 'ArrowUp' ? -1 : 1)));
    const message = entries[nextIndex];
    const savedDraft = browse?.draft ?? editor.getValue().slotConfig;
    const slots = message ? createMessageDraftSlots(message, skills, plugins) : savedDraft;
    event.preventDefault();
    event.stopPropagation();
    browseRef.current = message ? { messageId: message.id, draft: savedDraft, value: message.content } : null;
    editor.clear();
    editor.insert(slots, 'start');
    onRestore(slots);
    // Stay at the first character so repeated arrows continue browsing history.
    editor.focus({ cursor: 'start', preventScroll: true });
    editor.inputElement.scrollTop = 0;
    return true;
  };
}
