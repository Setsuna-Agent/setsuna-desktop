import { ChatPromptInput } from './composer/editor/ChatPromptInput.js';
import type { ComposerSlot } from './composer/editor/types.js';
import type {
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeQueuedTurnInput,
  RuntimeSkillSummary,
  RuntimeThread,
  WorkspaceEntrySearchItem,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import {
  chatComposerStatusSlot,
  type ChatComposerActiveTurn,
} from '@setsuna-desktop/renderer-contracts/chat';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  ChatImageAttachmentOutcome,
  ChatImageAttachmentRequest,
  ChatCapabilitySelectionRequest,
  ChatWorkspaceMentionRequest,
} from '../../app/types.js';
import { RendererOwnedListSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import { ChatAttachmentTray } from './composer/ChatAttachmentTray.js';
import { ChatComposerFooter } from './composer/ChatComposerFooter.js';
import { ChatComposerOverlays } from './composer/ChatComposerOverlays.js';
import { ChatSendQueue } from './composer/ChatSendQueue.js';
import type { SlashCommandMenuItem } from './composer/ChatSlashCommandMenu.js';
import { parseMentionCommand, parseSlashCommand } from './composer/chatCommandUtils.js';
import { createComposerDraftSyncPlan } from './composer/chatComposerDraftSync.js';
import type { ChatComposerSendOptions } from './composer/chatComposerSendOptions.js';
import { startChatComposerCapabilitySelection, type ChatComposerCapabilitySelection } from './composer/chatComposerCapabilitySelection.js';
import { parsePluginMentions, type RuntimePluginSummary } from '@setsuna-desktop/contracts';
import {
  createSelectedSkillReferences,
  createSelectedSkillSlot,
  createSelectedPluginSlot,
  createPluginDraftSlots,
  createTextSlot,
  createWorkspaceMentionInsertion,
  createWorkspaceMentionSlots,
  filterSelectedSkillsBySlots,
} from './composer/chatComposerSlots.js';
import { createChatSlashCommandItems } from './composer/chatSlashCommandItems.js';
import { useChatAttachments } from './composer/useChatAttachments.js';
import { useChatCommandController } from './composer/useChatCommandController.js';
import { useChatComposerClipboard } from './composer/useChatComposerClipboard.js';
import { useChatComposerModeController } from './composer/useChatComposerModeController.js';
import { useQueuedTurnComposerEdit } from './composer/useQueuedTurnComposerEdit.js';
import type { ChatContextTokenUsage } from './conversation/chatContextUsage.js';
import type { ChatQueuedTurnActions } from './hooks/useQueuedTurnInputActions.js';
import {
  chatThreadModelSelection,
  type ChatModelSelectionHandler,
} from './chatModelSelection.js';

const EMPTY_PLUGINS: RuntimePluginSummary[] = [];
const EMPTY_QUEUED_TURN_INPUTS: RuntimeQueuedTurnInput[] = [];
const CAPABILITY_SELECTION_MAX_INSERT_ATTEMPTS = 8;

type ComposerFocusTarget = {
  focus?: (options: { cursor?: 'start' | 'end' | 'all'; preventScroll?: boolean }) => void;
};

export function applyChatComposerFocusRequest(
  editor: ComposerFocusTarget | null,
  focusOnReveal: boolean,
  focusRequest: number,
  onConsumed?: (requestId: number) => void,
): void {
  if ((!focusOnReveal && focusRequest === 0) || !editor) return;
  editor.focus?.({ cursor: 'end', preventScroll: true });
  if (focusRequest !== 0) onConsumed?.(focusRequest);
}

export function composerActiveTurn(
  thread: RuntimeThread | null | undefined,
  activeTurnId: string | null,
): ChatComposerActiveTurn | undefined {
  if (!thread || !activeTurnId) return undefined;
  const turn = thread.turns?.find((candidate) => candidate.id === activeTurnId);
  if (!turn) return undefined;
  return {
    ...(turn.startedAt ? { startedAt: turn.startedAt } : {}),
    ...(turn.taskKind ? { taskKind: turn.taskKind } : {}),
  };
}

export function ChatComposer({
  activeTurnId,
  activeProject,
  client,
  config,
  canClearContext,
  contextCompacting = false,
  contextUsage,
  currentThread,
  draft,
  focusOnReveal = false,
  focusRequest = 0,
  imageAttachmentRequest,
  capabilitySelectionRequest,
  workspaceMentionRequest,
  skills,
  plugins = EMPTY_PLUGINS,
  sideConversation = false,
  starter = false,
  placeholder,
  onCancelActiveTurn,
  onAccessModeChange,
  onCompactContext,
  onClearContext,
  onDraftChange,
  onFocusRequestConsumed,
  onSelectModel,
  onSearchProjectEntries,
  onOpenSideChat,
  onSetMultiAgentEnabled,
  onSend,
  queuedTurnActions,
  onStartThreadReview,
  onImageAttachmentRequestConsumed,
  onCapabilitySelectionRequestConsumed,
  onWorkspaceMentionRequestConsumed,
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  client: DesktopRuntimeClient;
  config: RuntimeConfigState | null;
  canClearContext: boolean;
  contextCompacting?: boolean;
  contextUsage: ChatContextTokenUsage;
  currentThread: RuntimeThread | null;
  draft: string;
  focusOnReveal?: boolean;
  focusRequest?: number;
  imageAttachmentRequest?: ChatImageAttachmentRequest | null;
  capabilitySelectionRequest?: ChatCapabilitySelectionRequest | null;
  workspaceMentionRequest?: ChatWorkspaceMentionRequest | null;
  skills: RuntimeSkillSummary[];
  plugins?: RuntimePluginSummary[];
  sideConversation?: boolean;
  starter?: boolean;
  placeholder?: string;
  onCancelActiveTurn: () => void;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDraftChange: (value: string) => void;
  onFocusRequestConsumed?: (requestId: number) => void;
  onSelectModel: ChatModelSelectionHandler;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onOpenSideChat?: () => void;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onSend: (value?: string, options?: ChatComposerSendOptions) => Promise<boolean>;
  queuedTurnActions: ChatQueuedTurnActions;
  onStartThreadReview: (
    target: ReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ) => Promise<unknown>;
  onImageAttachmentRequestConsumed?: (requestId: number, outcome: ChatImageAttachmentOutcome) => void;
  onCapabilitySelectionRequestConsumed?: (requestId: number) => void;
  onWorkspaceMentionRequestConsumed?: (requestId: number) => void;
}) {
  const { t } = useI18n();
  const [selectedSkills, setSelectedSkills] = useState<RuntimeSkillSummary[]>([]);
  const selectedPluginIds = useMemo(() => [...new Set(parsePluginMentions(draft).map((mention) => mention.pluginId))], [draft]);
  const [pendingModelSelection, setPendingModelSelection] = useState<{
    reference: RuntimeConfiguredModelReference;
    threadId: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const senderRef = useRef<ComponentRef<typeof ChatPromptInput>>(null);
  const lastEditorDraftRef = useRef(draft);
  const previousExternalDraftRef = useRef(draft);
  const consumedImageAttachmentRequestIdRef = useRef<number | null>(null);
  const consumedCapabilitySelectionRequestIdRef = useRef<number | null>(null);
  const consumedWorkspaceMentionRequestIdRef = useRef<number | null>(null);
  const modelSelectionRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const initialSlotConfigRef = useRef<ComposerSlot[] | null>(null);
  if (initialSlotConfigRef.current === null) initialSlotConfigRef.current = createPluginDraftSlots(draft, plugins);
  const addSelectedSkills = useCallback((nextSkills: RuntimeSkillSummary[]) => {
    if (!nextSkills.length) return;
    setSelectedSkills((current) => {
      const selectedIds = new Set(current.map((skill) => skill.id));
      const additions = nextSkills.filter((skill) => !selectedIds.has(skill.id));
      return additions.length ? [...current, ...additions] : current;
    });
  }, []);
  const queuedTurnInputs = currentThread?.queuedTurnInputs ?? EMPTY_QUEUED_TURN_INPUTS;
  const projectConversation = currentThread
    ? Boolean(currentThread.projectId)
    : Boolean(activeProject);
  const deleteQueuedTurnInput = queuedTurnActions.deleteQueuedTurnInput;
  const sendQueuedTurnInputNow = queuedTurnActions.sendQueuedTurnInputNow;
  const getComposerEditor = useCallback(() => senderRef.current, []);
  const getComposerInputElement = useCallback(() => getComposerEditor()?.inputElement ?? null, [getComposerEditor]);
  const persistedThreadModel = useMemo(
    () => chatThreadModelSelection(config, currentThread),
    [config, currentThread],
  );
  const persistedReference = persistedThreadModel.reference;
  const pendingMatchesPersisted = Boolean(
    pendingModelSelection
    && pendingModelSelection.threadId === (currentThread?.id ?? null)
    && pendingModelSelection.reference.providerId === persistedReference?.providerId
    && pendingModelSelection.reference.modelId === persistedReference.modelId
    // A matching configured model proves that the persisted modelCode is still the same.
    && (!currentThread?.modelBinding || persistedThreadModel.model),
  );
  const pendingReference = pendingModelSelection
    && pendingModelSelection.threadId === (currentThread?.id ?? null)
    && !pendingMatchesPersisted
    ? pendingModelSelection.reference
    : undefined;
  const selectedThreadModel = useMemo(
    () => pendingReference
      ? chatThreadModelSelection(config, currentThread, pendingReference)
      : persistedThreadModel,
    [config, currentThread, pendingReference, persistedThreadModel],
  );
  const turnModelSelection = pendingReference
    ?? (currentThread?.modelBinding ? undefined : selectedThreadModel.reference ?? undefined);
  useEffect(() => {
    if (pendingMatchesPersisted) setPendingModelSelection(null);
  }, [pendingMatchesPersisted]);
  const activeComposerTurn = useMemo(
    () => composerActiveTurn(currentThread, activeTurnId),
    [activeTurnId, currentThread?.turns],
  );
  const modeController = useChatComposerModeController({
    currentThreadId: currentThread?.id,
    model: selectedThreadModel.model,
    provider: selectedThreadModel.provider,
  });
  const clipboardHandlers = useChatComposerClipboard({
    allowStructuredPaste: !modeController.reviewModeEnabled,
    getEditor: getComposerEditor,
    onSkillsRestored: addSelectedSkills,
    plugins,
    skills,
  });

  const selectModel = useCallback((providerId: string, modelId: string) => {
    const requestId = modelSelectionRequestRef.current + 1;
    modelSelectionRequestRef.current = requestId;
    const reference = { providerId, modelId };
    setPendingModelSelection({ reference, threadId: currentThread?.id ?? null });
    try {
      const result = onSelectModel(providerId, modelId, currentThread?.id);
      void Promise.resolve(result).catch(() => {
        if (modelSelectionRequestRef.current === requestId) setPendingModelSelection(null);
      });
    } catch {
      if (modelSelectionRequestRef.current === requestId) setPendingModelSelection(null);
    }
  }, [currentThread?.id, onSelectModel]);
  const {
    addExistingImage,
    addFiles: addAttachmentFiles,
    atLimit: attachmentLimitReached,
    beginSend: beginAttachmentSend,
    busy: attachmentsBusy,
    clear: clearAttachments,
    items: attachmentItems,
    remove: removeAttachment,
    replaceWithExisting: replaceAttachmentsWithExisting,
    sendableAttachments,
    settleSend: settleAttachmentSend,
  } = useChatAttachments({ client });
  const attachmentOnlyReady = sendableAttachments.length > 0 && !draft.trim();
  const activeQueueReady = Boolean(
    activeTurnId
    && (draft.trim() || sendableAttachments.length),
  );
  const contextCompactPercent = Math.round(Number(contextUsage.percent || 0));
  const multiAgentEnabled = !sideConversation
    && (config?.features?.multi_agent === true || config?.features?.multi_agent_v2 === true);
  const composerHasProtectedState = Boolean(
    draft
    || attachmentItems.length
    || selectedSkills.length
    || modeController.hasProtectedModeState,
  );
  const resetQueuedTurnComposer = useCallback(() => {
    clearAttachments();
    setSelectedSkills([]);
    onDraftChange('');
    lastEditorDraftRef.current = '';
    senderRef.current?.clear?.();
  }, [clearAttachments, onDraftChange]);
  const replaceQueuedTurnComposer = useCallback((input: RuntimeQueuedTurnInput) => {
    replaceAttachmentsWithExisting(input.attachments ?? []);
    setSelectedSkills([]);
    onDraftChange(input.input);
    senderRef.current?.focus?.({ cursor: 'end', preventScroll: true });
  }, [
    onDraftChange,
    replaceAttachmentsWithExisting,
  ]);
  const queuedTurnEdit = useQueuedTurnComposerEdit({
    actions: queuedTurnActions,
    attachmentsBusy,
    composerHasProtectedState,
    queuedTurnInputs,
    replaceComposer: replaceQueuedTurnComposer,
    resetComposer: resetQueuedTurnComposer,
    sendableAttachments,
    setSubmitting,
    submitting,
  });
  const attachmentPickerDisabled = attachmentLimitReached
    || submitting
    || queuedTurnEdit.retrieving
    || modeController.reviewModeEnabled;
  const commandController = useChatCommandController({
    activeProject,
    draft,
    getInputElement: getComposerInputElement,
    onSearchProjectEntries,
    slashMenuBlocked: queuedTurnEdit.editing || queuedTurnEdit.retrieving,
    t,
  });
  const slashEntries = useMemo(() => createChatSlashCommandItems({
    activeModelName: modeController.activeModelName,
    activeProjectSelected: Boolean(activeProject),
    activeTurnId,
    attachmentDisabled: attachmentPickerDisabled,
    canClearContext,
    contextCompactPercent,
    contextCompacting,
    goalModeEnabled: modeController.goalModeEnabled,
    hasReviewIncompatibleContent: Boolean(attachmentItems.length || selectedSkills.length || selectedPluginIds.length),
    multiAgentEnabled,
    query: commandController.slashQuery,
    plugins,
    selectedPluginIds,
    selectedSkills,
    sideChatAvailable: Boolean(onOpenSideChat),
    sideConversation,
    skills,
    t,
  }), [
    activeProject,
    activeTurnId,
    attachmentPickerDisabled,
    canClearContext,
    commandController.slashQuery,
    contextCompactPercent,
    contextCompacting,
    attachmentItems.length,
    modeController.activeModelName,
    modeController.goalModeEnabled,
    multiAgentEnabled,
    onOpenSideChat,
    sideConversation,
    selectedSkills,
    skills,
    plugins,
    selectedPluginIds,
    t,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    applyChatComposerFocusRequest(
      senderRef.current,
      focusOnReveal,
      focusRequest,
      onFocusRequestConsumed,
    );
  }, [focusOnReveal, focusRequest, onFocusRequestConsumed]);

  useEffect(() => {
    if (!workspaceMentionRequest || consumedWorkspaceMentionRequestIdRef.current === workspaceMentionRequest.requestId) return;
    const editor = senderRef.current;
    if (!editor) return;

    consumedWorkspaceMentionRequestIdRef.current = workspaceMentionRequest.requestId;
    const currentValue = editor.getValue();
    const insertion = createWorkspaceMentionInsertion(
      workspaceMentionRequest.entry,
      currentValue.value,
      currentValue.slotConfig,
    );
    if (insertion) {
      editor.focus({ cursor: 'end', preventScroll: true });
      editor.insert(insertion.slots, 'end', insertion.replaceCharacters, true);
    }
    commandController.focusComposer();
    onWorkspaceMentionRequestConsumed?.(workspaceMentionRequest.requestId);
  }, [
    commandController.focusComposer,
    onWorkspaceMentionRequestConsumed,
    workspaceMentionRequest,
  ]);

  useEffect(() => {
    if (!capabilitySelectionRequest || consumedCapabilitySelectionRequestIdRef.current === capabilitySelectionRequest.requestId) return;
    if (modeController.reviewModeEnabled) {
      consumedCapabilitySelectionRequestIdRef.current = capabilitySelectionRequest.requestId;
      onCapabilitySelectionRequestConsumed?.(capabilitySelectionRequest.requestId);
      return;
    }
    const skill = capabilitySelectionRequest.kind === 'skill' ? skills.find((item) => item.id === capabilitySelectionRequest.id && item.enabled) : undefined;
    const plugin = capabilitySelectionRequest.kind === 'plugin' ? plugins.find((item) => item.id === capabilitySelectionRequest.id) : undefined;
    const selection: ChatComposerCapabilitySelection | undefined = skill ? { kind: 'skill', value: skill } : plugin ? { kind: 'plugin', value: plugin } : undefined;
    if (!selection) return;

    return startChatComposerCapabilitySelection({
      getEditor: () => senderRef.current,
      maxAttempts: CAPABILITY_SELECTION_MAX_INSERT_ATTEMPTS,
      scheduler: {
        cancelFrame: window.cancelAnimationFrame.bind(window),
        requestFrame: window.requestAnimationFrame.bind(window),
      },
      selection,
      onConfirmed: () => {
        if (consumedCapabilitySelectionRequestIdRef.current === capabilitySelectionRequest.requestId) return;
        // Consume only after the tag survives ChatPromptInput initialization and a full frame.
        consumedCapabilitySelectionRequestIdRef.current = capabilitySelectionRequest.requestId;
        if (skill) addSelectedSkills([skill]);
        commandController.focusComposer();
        onCapabilitySelectionRequestConsumed?.(capabilitySelectionRequest.requestId);
      },
    });
  }, [
    addSelectedSkills,
    commandController.focusComposer,
    modeController.reviewModeEnabled,
    onCapabilitySelectionRequestConsumed,
    capabilitySelectionRequest,
    skills,
    plugins,
  ]);

  useEffect(() => {
    if (!imageAttachmentRequest || consumedImageAttachmentRequestIdRef.current === imageAttachmentRequest.requestId) return;
    if (modeController.reviewModeEnabled) {
      consumedImageAttachmentRequestIdRef.current = imageAttachmentRequest.requestId;
      onImageAttachmentRequestConsumed?.(imageAttachmentRequest.requestId, 'unsupported');
      return;
    }
    consumedImageAttachmentRequestIdRef.current = imageAttachmentRequest.requestId;
    const outcome = addExistingImage(imageAttachmentRequest.attachment);
    if (outcome === 'added') {
      commandController.focusComposer();
    }
    onImageAttachmentRequestConsumed?.(imageAttachmentRequest.requestId, outcome);
  }, [
    addExistingImage,
    commandController.focusComposer,
    imageAttachmentRequest,
    modeController.reviewModeEnabled,
    onImageAttachmentRequestConsumed,
  ]);

  const selectEntry = (entry?: WorkspaceEntrySearchItem) => {
    const command = commandController.mentionCommand
      ?? parseMentionCommand(draft, commandController.commandCursorOffset);
    if (!command || !entry) return;
    senderRef.current?.insert?.(
      createWorkspaceMentionSlots(entry),
      'cursor',
      draft.slice(command.start, command.end),
      true,
    );
    commandController.acceptMentionSelection();
  };

  const selectCapability = (selection: ChatComposerCapabilitySelection) => {
    if (modeController.reviewModeEnabled) {
      commandController.closeSlashMenu();
      commandController.focusComposer();
      return;
    }
    const command = commandController.slashCommand
      ?? parseSlashCommand(draft, commandController.commandCursorOffset);
    if (!command && !commandController.forcedSlashMenuOpen) return;
    senderRef.current?.insert?.(
      [selection.kind === 'skill' ? createSelectedSkillSlot(selection.value) : createSelectedPluginSlot(selection.value), createTextSlot(' ')],
      'cursor',
      command ? draft.slice(command.start, command.end) : undefined,
      true,
    );
    commandController.acceptSlashSelection();
    if (selection.kind === 'skill') addSelectedSkills([selection.value]);
  };

  const handleChange = (value: string, _event?: unknown, slotConfig?: ComposerSlot[]) => {
    commandController.handleDraftValueChange(value);
    setSelectedSkills((current) => filterSelectedSkillsBySlots(current, slotConfig));
    lastEditorDraftRef.current = value;
    onDraftChange(value);
  };

  useEffect(() => {
    const editor = senderRef.current;
    if (!editor) return;
    const currentEditorValue = editor.getValue();
    const previousExternalDraft = previousExternalDraftRef.current;
    previousExternalDraftRef.current = draft;
    const syncPlan = createComposerDraftSyncPlan(
      draft,
      previousExternalDraft,
      lastEditorDraftRef.current,
      currentEditorValue.value,
    );
    if (syncPlan.type === 'none') return;
    if (syncPlan.type === 'adopt') {
      lastEditorDraftRef.current = draft;
      return;
    }

    if (syncPlan.type === 'replace') editor.clear();
    if (syncPlan.value) {
      // 先聚焦到末尾，确保外部文件引用插入到当前草稿。
      editor.focus({ cursor: 'end', preventScroll: true });
      editor.insert(createPluginDraftSlots(syncPlan.value, plugins), 'end', undefined, true);
    }
  }, [draft, plugins]);

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (commandController.slashMenuOpen) {
      return commandController.handleSlashKeyDown(event, slashEntries, selectSlashEntry);
    }
    if (commandController.mentionMenuOpen) {
      return commandController.handleMentionKeyDown(event, selectEntry);
    }
    return submitActiveQueueFromKeyboard(event);
  };

  const selectSlashEntry = (item?: SlashCommandMenuItem) => {
    if (!item) return;
    if (item.kind === 'skill') {
      selectCapability({ kind: 'skill', value: item.skill });
      return;
    }
    if (item.kind === 'plugin') {
      selectCapability({ kind: 'plugin', value: item.plugin });
      return;
    }
    commandController.closeSlashMenu();
    if (item.kind === 'action' && item.disabled) {
      commandController.focusComposer();
      return;
    }
    const command = commandController.slashCommand
      ?? parseSlashCommand(draft, commandController.commandCursorOffset);
    const nextDraft = command ? `${draft.slice(0, command.start)}${draft.slice(command.end)}`.trimStart() : draft;
    commandController.clearSlashDismissal();
    const shouldPrefillReview = item.kind === 'action'
      && item.type === 'review'
      && !nextDraft.trim();
    const selectedDraft = shouldPrefillReview
      ? t('chat.composer.reviewPrompt')
      : nextDraft;
    if (command) {
      // Replace the command with the review prompt in the editor itself. Sending
      // only an external value update races ChatPromptInput's delayed command-removal echo.
      senderRef.current?.insert?.(
        [createTextSlot(shouldPrefillReview ? selectedDraft : '')],
        'cursor',
        draft.slice(command.start, command.end),
        true,
      );
    }
    onDraftChange(selectedDraft);
    if (item.kind === 'model') {
      modeController.openModelPicker();
      return;
    }
    if (item.kind === 'action' && item.type === 'attachment') {
      fileInputRef.current?.click();
      return;
    }
    if (item.kind === 'action' && item.type === 'collaboration') {
      if (!multiAgentEnabled) void onSetMultiAgentEnabled(true);
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'goal') {
      modeController.enableGoalMode();
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'review' && !item.disabled) {
      modeController.enableReviewMode();
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'side-chat' && !item.disabled) {
      onOpenSideChat?.();
      return;
    }
    if (item.type === 'clear-context' && !item.disabled) {
      onClearContext();
      return;
    }
    if (item.type === 'compact-context' && !item.disabled) {
      onCompactContext();
    }
  };

  const submitDraft = async (value?: string) => {
    if (attachmentsBusy || submitting) return;
    // Send buttons hand focus back before locking the editor, never after an async response.
    senderRef.current?.focus({ preventScroll: true });
    if (queuedTurnEdit.editing) {
      await queuedTurnEdit.submit(value ?? draft);
      return;
    }
    if (modeController.reviewModeEnabled) {
      const instructions = (value ?? draft).trim();
      if (!instructions) return;
      // Clear the session before starting so a first-turn review can claim the
      // newly created thread without carrying the submitted draft into it.
      onDraftChange('');
      setSubmitting(true);
      let sent = false;
      try {
        await onStartThreadReview(
          { type: 'custom', instructions },
          turnModelSelection,
        );
        sent = true;
      } catch {
        if (mountedRef.current) {
          onDraftChange(instructions);
          modeController.enableReviewMode();
        }
      }
      if (!mountedRef.current) return;
      setSubmitting(false);
      if (!sent) return;
      modeController.resetAfterSend();
      senderRef.current?.clear?.();
      return;
    }
    const skillReferences = createSelectedSkillReferences(senderRef.current?.getValue().slotConfig);
    const sendOptions = modeController.createSendOptions({
      attachments: sendableAttachments,
      selectedSkillIds: skillReferences.length
        ? [...new Set(skillReferences.map((reference) => reference.skillId))]
        : selectedSkills.map((skill) => skill.id),
      selectedSkillReferences: skillReferences,
    });
    sendOptions.modelSelection = turnModelSelection;
    const submittedAttachments = sendOptions.attachments ?? [];
    beginAttachmentSend(submittedAttachments);
    setSubmitting(true);
    const sent = await onSend(value, sendOptions).catch(() => false);
    settleAttachmentSend(submittedAttachments, sent);
    if (!mountedRef.current) return;
    setSubmitting(false);
    if (!sent) return;
    setSelectedSkills([]);
    modeController.resetAfterSend();
    senderRef.current?.clear?.();
  };

  const addFiles = (files: File[]) => {
    if (!files.length || submitting || queuedTurnEdit.retrieving || modeController.reviewModeEnabled) return;
    void addAttachmentFiles(files);
  };

  const submitActiveQueueFromKeyboard = (event: ReactKeyboardEvent) => {
    if (!activeQueueReady || !isPlainEnter(event)) return undefined;
    event.preventDefault();
    event.stopPropagation();
    void submitDraft(draft);
    return false;
  };

  const openSlashMenu = () => {
    commandController.toggleSlashMenu();
    senderRef.current?.focus?.({ preventScroll: true });
  };

  return (
    <div
      className={`chat-sender ${starter ? 'chat-sender--starter' : ''}`}
      {...clipboardHandlers}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="chat-sender__file-input"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          addFiles(files);
          commandController.focusComposer();
        }}
      />
      <ChatComposerOverlays
        mentionMenu={{
          activeIndex: commandController.activeMentionIndex,
          entries: commandController.entries,
          hasProject: Boolean(activeProject),
          loadError: commandController.loadError,
          loading: commandController.loading,
          open: commandController.mentionMenuOpen,
          onHover: commandController.setActiveMentionIndex,
          onSelect: selectEntry,
        }}
        slashMenu={{
          activeIndex: commandController.activeSlashIndex,
          items: slashEntries,
          open: commandController.slashMenuOpen,
          onHover: commandController.setActiveSlashIndex,
          onSelect: selectSlashEntry,
        }}
      />
      <div className="chat-composer-stack">
        {currentThread ? (
          <RendererOwnedListSlot
            slot={chatComposerStatusSlot}
            props={{
              activeTurn: activeComposerTurn,
              threadId: currentThread.id,
              translate: t,
            }}
          />
        ) : null}
        <ChatSendQueue
          disabled={submitting || queuedTurnEdit.editing}
          editDisabled={queuedTurnEdit.editDisabled}
          hasActiveTurn={Boolean(activeTurnId)}
          items={queuedTurnEdit.visibleQueuedTurnInputs}
          onDelete={deleteQueuedTurnInput}
          onEdit={queuedTurnEdit.edit}
          onSendNow={sendQueuedTurnInputNow}
        />
      </div>
      <ChatPromptInput
        ref={senderRef}
        value={draft}
        disabled={submitting || queuedTurnEdit.retrieving}
        slotConfig={initialSlotConfigRef.current}
        loading={Boolean(activeTurnId)}
        placeholder={placeholder ?? t(projectConversation
          ? 'chat.composer.projectPlaceholder'
          : 'chat.composer.placeholder')}
        autoSize={{ minRows: 2, maxRows: 6 }}
        onBlur={commandController.handleComposerBlur}
        onChange={handleChange}
        onFocus={commandController.handleComposerFocus}
        onKeyDown={handleKeyDown}
        onKeyUp={commandController.updateCursorOffset}
        onPasteFile={(files) => {
          addFiles(Array.from(files));
          commandController.focusComposer();
        }}
        onSubmit={submitDraft}
        onCancel={onCancelActiveTurn}
        header={
          <ChatAttachmentTray disabled={submitting} items={attachmentItems} onRemove={removeAttachment} />
        }
        footer={(actions) => (
          <ChatComposerFooter
            commandControl={{
              active: commandController.forcedSlashMenuOpen,
              disabled: queuedTurnEdit.editing || queuedTurnEdit.retrieving,
              onOpen: openSlashMenu,
            }}
            config={config}
            contextCompacting={contextCompacting}
            contextUsage={contextUsage}
            editingControl={{
              active: queuedTurnEdit.editing,
              disabled: submitting,
              onCancel: () => void queuedTurnEdit.cancel(),
            }}
            hasActiveTurn={Boolean(activeTurnId)}
            modeBadges={{
              collaborationEnabled: multiAgentEnabled,
              goalModeEnabled: modeController.goalModeEnabled,
              onClearGoal: modeController.clearGoalMode,
              onClearReview: modeController.clearReviewMode,
              onDisableCollaboration: () => void onSetMultiAgentEnabled(false),
              reviewModeEnabled: modeController.reviewModeEnabled,
            }}
            modelOpenSignal={modeController.modelOpenSignal}
            model={selectedThreadModel.model}
            modelFallbackCode={selectedThreadModel.fallbackModelCode}
            modelProvider={selectedThreadModel.provider}
            primaryAction={{
              attachmentOnlyReady,
              attachmentsBusy,
              queueReady: activeQueueReady,
              submitting,
              onCancelActiveTurn,
              onSubmit: () => void submitDraft(draft),
            }}
            senderActions={actions}
            thinkingControl={{
              config: modeController.thinkingConfig,
              disabled: queuedTurnEdit.editing || queuedTurnEdit.retrieving,
              effort: modeController.thinkingEffort,
              enabled: modeController.thinkingEnabled,
              menuOpen: modeController.thinkingMenuOpen,
              onEffortChange: modeController.setThinkingEffort,
              onEnabledChange: modeController.setThinkingEnabled,
              onMenuOpenChange: modeController.setThinkingMenuOpen,
            }}
            onAccessModeChange={onAccessModeChange}
            onSelectModel={selectModel}
          />
        )}
      />
    </div>
  );
}

function isPlainEnter(event: ReactKeyboardEvent): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !nativeEvent.isComposing;
}
