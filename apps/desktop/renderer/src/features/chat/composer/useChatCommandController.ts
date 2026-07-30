import type {
  WorkspaceEntrySearchItem,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import type { SlashCommandMenuItem } from './ChatSlashCommandMenu.js';
import {
  createChatComposerCommandState,
  moveChatCommandMenuIndex,
} from './chatComposerCommandState.js';
import { readComposerCursorOffset } from './chatComposerCursorOffset.js';
import {
  emptyProjectEntrySearchState,
  startProjectEntrySearch,
} from './chatProjectEntrySearch.js';

export function useChatCommandController({
  activeProject,
  draft,
  getInputElement,
  onSearchProjectEntries,
  slashMenuBlocked,
  t,
}: {
  activeProject?: WorkspaceProject;
  draft: string;
  getInputElement: () => HTMLElement | null;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  slashMenuBlocked: boolean;
  t: Translate;
}) {
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [cursorOffset, setCursorOffset] = useState<number | null>(null);
  const [dismissedMentionDraft, setDismissedMentionDraft] = useState('');
  const [dismissedSlashDraft, setDismissedSlashDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [forcedSlashMenuOpen, setForcedSlashMenuOpen] = useState(false);
  const [searchState, setSearchState] = useState(emptyProjectEntrySearchState);
  const state = useMemo(() => createChatComposerCommandState({
    cursorOffset,
    dismissedMentionDraft,
    dismissedSlashDraft,
    draft,
    focused,
    forcedSlashMenuOpen,
    slashMenuBlocked,
  }), [
    cursorOffset,
    dismissedMentionDraft,
    dismissedSlashDraft,
    draft,
    focused,
    forcedSlashMenuOpen,
    slashMenuBlocked,
  ]);

  useEffect(() => {
    if (!state.mentionMenuOpen || !activeProject) {
      setSearchState(emptyProjectEntrySearchState);
      return undefined;
    }

    setActiveMentionIndex(0);
    return startProjectEntrySearch({
      onStateChange: setSearchState,
      query: state.mentionQuery,
      search: onSearchProjectEntries,
      t,
    });
  }, [
    activeProject,
    onSearchProjectEntries,
    state.mentionMenuOpen,
    state.mentionQuery,
    t,
  ]);

  const updateCursorOffset = useCallback(() => {
    setCursorOffset(readComposerCursorOffset(getInputElement()));
  }, [getInputElement]);

  useEffect(() => {
    if (!focused) return undefined;
    const inputDocument = getInputElement()?.ownerDocument ?? document;
    updateCursorOffset();
    inputDocument.addEventListener('selectionchange', updateCursorOffset);
    return () => inputDocument.removeEventListener('selectionchange', updateCursorOffset);
  }, [focused, getInputElement, updateCursorOffset]);

  useEffect(() => {
    setActiveSlashIndex(0);
  }, [state.slashQuery]);

  const handleDraftValueChange = useCallback((value: string) => {
    setDismissedMentionDraft((current) => (current && current !== value ? '' : current));
    setDismissedSlashDraft((current) => (current && current !== value ? '' : current));
    setForcedSlashMenuOpen(false);
    updateCursorOffset();
  }, [updateCursorOffset]);

  const handleComposerBlur = useCallback(() => {
    setFocused(false);
    setForcedSlashMenuOpen(false);
  }, []);

  const handleComposerFocus = useCallback(() => {
    setFocused(true);
    updateCursorOffset();
  }, [updateCursorOffset]);

  const focusComposer = useCallback(() => {
    setFocused(true);
  }, []);

  const acceptMentionSelection = useCallback(() => {
    setDismissedMentionDraft('');
    setFocused(true);
  }, []);

  const acceptSlashSelection = useCallback(() => {
    setDismissedSlashDraft('');
    setForcedSlashMenuOpen(false);
    setFocused(true);
  }, []);

  const clearSlashDismissal = useCallback(() => {
    setDismissedSlashDraft('');
  }, []);

  const closeSlashMenu = useCallback(() => {
    setForcedSlashMenuOpen(false);
  }, []);

  const toggleSlashMenu = useCallback(() => {
    setActiveSlashIndex(0);
    setDismissedSlashDraft('');
    setForcedSlashMenuOpen((open) => !open);
    setFocused(true);
  }, []);

  const handleMentionKeyDown = useCallback((
    event: ReactKeyboardEvent,
    onSelect: (entry?: WorkspaceEntrySearchItem) => void,
  ) => {
    if (event.key === 'Escape') {
      stopMenuKeyboardEvent(event);
      setDismissedMentionDraft(draft);
      return false;
    }
    if (!searchState.entries.length) return undefined;
    if (event.key === 'ArrowDown') {
      stopMenuKeyboardEvent(event);
      setActiveMentionIndex((current) => (
        moveChatCommandMenuIndex(current, 1, searchState.entries.length)
      ));
      return false;
    }
    if (event.key === 'ArrowUp') {
      stopMenuKeyboardEvent(event);
      setActiveMentionIndex((current) => (
        moveChatCommandMenuIndex(current, -1, searchState.entries.length)
      ));
      return false;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      stopMenuKeyboardEvent(event);
      onSelect(searchState.entries[activeMentionIndex]);
      return false;
    }
    return undefined;
  }, [activeMentionIndex, draft, searchState.entries]);

  const handleSlashKeyDown = useCallback((
    event: ReactKeyboardEvent,
    items: SlashCommandMenuItem[],
    onSelect: (item?: SlashCommandMenuItem) => void,
  ) => {
    if (event.key === 'Escape') {
      stopMenuKeyboardEvent(event);
      setDismissedSlashDraft(draft);
      setForcedSlashMenuOpen(false);
      return false;
    }
    if (!items.length) return undefined;
    if (event.key === 'ArrowDown') {
      stopMenuKeyboardEvent(event);
      setActiveSlashIndex((current) => moveChatCommandMenuIndex(current, 1, items.length));
      return false;
    }
    if (event.key === 'ArrowUp') {
      stopMenuKeyboardEvent(event);
      setActiveSlashIndex((current) => moveChatCommandMenuIndex(current, -1, items.length));
      return false;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      stopMenuKeyboardEvent(event);
      onSelect(items[activeSlashIndex]);
      return false;
    }
    return undefined;
  }, [activeSlashIndex, draft]);

  return {
    ...state,
    acceptMentionSelection,
    acceptSlashSelection,
    activeMentionIndex,
    activeSlashIndex,
    clearSlashDismissal,
    closeSlashMenu,
    entries: searchState.entries,
    focusComposer,
    forcedSlashMenuOpen,
    handleComposerBlur,
    handleComposerFocus,
    handleDraftValueChange,
    handleMentionKeyDown,
    handleSlashKeyDown,
    loadError: searchState.loadError,
    loading: searchState.loading,
    setActiveMentionIndex,
    setActiveSlashIndex,
    toggleSlashMenu,
    updateCursorOffset,
  };
}

function stopMenuKeyboardEvent(event: ReactKeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}
