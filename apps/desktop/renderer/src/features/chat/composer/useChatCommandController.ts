import type {
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ProjectDesignEntry } from '@setsuna-desktop/feature-design/contracts';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { useDesignClient } from '../../../composition/design/DesignClientContext.js';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import { useBrowserTabMentions } from '../mentions/BrowserTabReference.js';
import { usePluginAppCatalog } from '../../../kernel/declarative-plugin-ui/app-appearance/usePluginAppCatalog.js';
import { chatMentionItems, type ChatMentionItem } from '../mentions/chatMentionItems.js';
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
  designProjectId,
  draft,
  plugins,
  getInputElement,
  onSearchProjectEntries,
  slashMenuBlocked,
  t,
}: {
  activeProject?: WorkspaceProject;
  designProjectId?: string;
  draft: string;
  plugins: readonly RuntimePluginSummary[];
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
  const browserTabs = useBrowserTabMentions();
  const apps = usePluginAppCatalog(plugins);
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

  const client = useDesignClient();
  const toast = useToast();
  const projectId = state.mentionMenuOpen ? designProjectId : undefined;
  const [designList, setDesignList] = useState<{ projectId: string; owners: ProjectDesignEntry[] }>();
  useEffect(() => {
    if (!client || !projectId) return;
    const controller = new AbortController();
    setDesignList(undefined);
    void client.projectDesigns(projectId, controller.signal).then((owners) => {
      if (!controller.signal.aborted) setDesignList({ projectId, owners });
    }).catch((error: unknown) => { if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [client, projectId, toast]);
  const designs = projectId && designList?.projectId === projectId ? designList.owners : undefined;
  const mentionItems = useMemo(() => chatMentionItems(browserTabs, searchState.entries, state.mentionQuery, apps, designs),
    [browserTabs, searchState.entries, state.mentionQuery, apps, designs]);
  const browserTabIds = browserTabs.map((tab) => tab.id).join('\n');
  useEffect(() => { setActiveMentionIndex(0); }, [state.mentionQuery, browserTabIds]);
  const mentionIndex = Math.min(activeMentionIndex, Math.max(0, mentionItems.length - 1));

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
  }, [state.slashQuery, state.skillCommand?.start]);

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
    onSelect: (entry?: ChatMentionItem) => void,
  ) => {
    if (event.key === 'Escape') {
      stopMenuKeyboardEvent(event);
      setDismissedMentionDraft(draft);
      return false;
    }
    if (!mentionItems.length) return undefined;
    if (event.key === 'ArrowDown') {
      stopMenuKeyboardEvent(event);
      setActiveMentionIndex(moveChatCommandMenuIndex(mentionIndex, 1, mentionItems.length));
      return false;
    }
    if (event.key === 'ArrowUp') {
      stopMenuKeyboardEvent(event);
      setActiveMentionIndex(moveChatCommandMenuIndex(mentionIndex, -1, mentionItems.length));
      return false;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      stopMenuKeyboardEvent(event);
      onSelect(mentionItems[mentionIndex]);
      return false;
    }
    return undefined;
  }, [mentionIndex, draft, mentionItems]);

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
    activeMentionIndex: mentionIndex,
    activeSlashIndex,
    canMentionProjectDesigns: Boolean(client && designProjectId),
    clearSlashDismissal,
    closeSlashMenu,
    mentionItems,
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
