import { Sender } from '@ant-design/x';
import type { SlotConfigType } from '@ant-design/x/es/sender';
import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeQueuedTurnInput,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadGoalPatch,
  RuntimeThreadMemoryMode,
  RuntimeUsageResponse,
  WorkspaceEntrySearchItem,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
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
  ChatSkillSelectionRequest,
  ChatWorkspaceMentionRequest,
} from '../../app/types.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import { ChatAttachmentTray } from './composer/ChatAttachmentTray.js';
import { ChatComposerFooter } from './composer/ChatComposerFooter.js';
import { ChatGoalStatusBar } from './composer/ChatGoalStatusBar.js';
import { ChatComposerOverlays } from './composer/ChatComposerOverlays.js';
import { ChatSendQueue } from './composer/ChatSendQueue.js';
import type { SlashCommandMenuItem } from './composer/ChatSlashCommandMenu.js';
import { chatAttachmentAccept } from './composer/chatAttachments.js';
import { parseMentionCommand, parseSlashCommand } from './composer/chatCommandUtils.js';
import { createComposerDraftSyncPlan } from './composer/chatComposerDraftSync.js';
import type { ChatComposerSendOptions } from './composer/chatComposerSendOptions.js';
import { startChatComposerSkillSelection } from './composer/chatComposerSkillSelection.js';
import {
  createSelectedSkillReferences,
  createSelectedSkillSlot,
  createTextSlot,
  createWorkspaceMentionInsertion,
  createWorkspaceMentionSlots,
  filterSelectedSkillsBySlots,
} from './composer/chatComposerSlots.js';
import {
  createChatSlashCommandItems,
  nextThreadMemoryMode,
} from './composer/chatSlashCommandItems.js';
import { useChatAttachments } from './composer/useChatAttachments.js';
import { useChatCommandController } from './composer/useChatCommandController.js';
import { useChatComposerModeController } from './composer/useChatComposerModeController.js';
import { useQueuedTurnComposerEdit } from './composer/useQueuedTurnComposerEdit.js';
import type { ChatContextTokenUsage } from './conversation/chatContextUsage.js';
import type { ChatQueuedTurnActions } from './hooks/useQueuedTurnInputActions.js';

const EMPTY_SLOT_CONFIG: SlotConfigType[] = [];
const EMPTY_QUEUED_TURN_INPUTS: RuntimeQueuedTurnInput[] = [];
const SKILL_SELECTION_MAX_INSERT_ATTEMPTS = 8;

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
  skillSelectionRequest,
  workspaceMentionRequest,
  skills,
  threadUsage,
  starter = false,
  placeholder,
  onCancelActiveTurn,
  onAccessModeChange,
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onUpdateThreadGoal = () => undefined,
  onDraftChange,
  onFocusRequestConsumed,
  onSelectModel,
  onSearchProjectEntries,
  onOpenSideChat,
  onSetMultiAgentEnabled,
  onSend,
  queuedTurnActions,
  onStartThreadReview,
  onThreadMemoryModeChange,
  onImageAttachmentRequestConsumed,
  onSkillSelectionRequestConsumed,
  onWorkspaceMentionRequestConsumed,
  threadMemoryMode,
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
  skillSelectionRequest?: ChatSkillSelectionRequest | null;
  workspaceMentionRequest?: ChatWorkspaceMentionRequest | null;
  skills: RuntimeSkillSummary[];
  threadUsage: RuntimeUsageResponse | null;
  starter?: boolean;
  placeholder?: string;
  threadMemoryMode?: RuntimeThreadMemoryMode;
  onCancelActiveTurn: () => void;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onUpdateThreadGoal?: (patch: RuntimeThreadGoalPatch) => void | Promise<unknown>;
  onDraftChange: (value: string) => void;
  onFocusRequestConsumed?: (requestId: number) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onOpenSideChat?: () => void;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onSend: (value?: string, options?: ChatComposerSendOptions) => Promise<boolean>;
  queuedTurnActions: ChatQueuedTurnActions;
  onStartThreadReview: () => void | Promise<unknown>;
  onThreadMemoryModeChange: (mode: RuntimeThreadMemoryMode) => void | Promise<void>;
  onImageAttachmentRequestConsumed?: (requestId: number, outcome: ChatImageAttachmentOutcome) => void;
  onSkillSelectionRequestConsumed?: (requestId: number) => void;
  onWorkspaceMentionRequestConsumed?: (requestId: number) => void;
}) {
  const { t } = useI18n();
  const [selectedSkills, setSelectedSkills] = useState<RuntimeSkillSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const senderRef = useRef<ComponentRef<typeof Sender>>(null);
  const lastEditorDraftRef = useRef(draft);
  const previousExternalDraftRef = useRef(draft);
  const consumedImageAttachmentRequestIdRef = useRef<number | null>(null);
  const consumedSkillSelectionRequestIdRef = useRef<number | null>(null);
  const consumedWorkspaceMentionRequestIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const initialSlotConfigRef = useRef<SlotConfigType[]>(draft ? [createTextSlot(draft)] : EMPTY_SLOT_CONFIG);
  const queuedTurnInputs = currentThread?.queuedTurnInputs ?? EMPTY_QUEUED_TURN_INPUTS;
  const deleteQueuedTurnInput = queuedTurnActions.deleteQueuedTurnInput;
  const sendQueuedTurnInputNow = queuedTurnActions.sendQueuedTurnInputNow;
  const getComposerInputElement = useCallback(() => senderRef.current?.inputElement ?? null, []);
  const currentGoal = currentThread?.goal?.status === 'complete'
    ? null
    : currentThread?.goal ?? null;
  const activeGoalTurnStartedAt = useMemo(() => (
    activeTurnId
      ? currentThread?.turns?.find((turn) => (
          turn.id === activeTurnId && turn.taskKind === 'goal'
        ))?.startedAt
      : undefined
  ), [activeTurnId, currentThread?.turns]);
  const modeController = useChatComposerModeController({
    activeGoal: currentGoal,
    config,
    currentThreadId: currentThread?.id,
    onClearThreadGoal,
  });
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
  const memoryMode = threadMemoryMode ?? 'enabled';
  const memoryGenerationEnabled = config?.memory?.generateMemories ?? config?.memoryEnabled ?? true;
  const multiAgentEnabled = config?.features?.multi_agent === true || config?.features?.multi_agent_v2 === true;
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
  const commandController = useChatCommandController({
    activeProject,
    draft,
    getInputElement: getComposerInputElement,
    onSearchProjectEntries,
    slashMenuBlocked: queuedTurnEdit.editing || queuedTurnEdit.retrieving,
    t,
  });
  const slashEntries = useMemo(() => createChatSlashCommandItems({
    activeGoal: currentGoal,
    activeModelName: modeController.activeModelName,
    activeProjectSelected: Boolean(activeProject),
    activeTurnId,
    canClearContext,
    contextCompactPercent,
    contextCompacting,
    goalEnabled: modeController.goalEnabled,
    goalModeEnabled: modeController.goalModeEnabled,
    hasCurrentThread: Boolean(currentThread),
    memoryGenerationEnabled,
    memoryMode,
    multiAgentEnabled,
    planModeEnabled: modeController.planModeEnabled,
    query: commandController.slashQuery,
    selectedSkills,
    sideChatAvailable: Boolean(onOpenSideChat),
    skills,
    t,
  }), [
    activeProject,
    activeTurnId,
    canClearContext,
    commandController.slashQuery,
    contextCompactPercent,
    contextCompacting,
    currentGoal,
    currentThread,
    memoryGenerationEnabled,
    memoryMode,
    modeController.activeModelName,
    modeController.goalEnabled,
    modeController.goalModeEnabled,
    modeController.planModeEnabled,
    multiAgentEnabled,
    onOpenSideChat,
    selectedSkills,
    skills,
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
    if (!skillSelectionRequest || consumedSkillSelectionRequestIdRef.current === skillSelectionRequest.requestId) return;
    const skill = skills.find((item) => item.id === skillSelectionRequest.skillId);
    if (!skill || !skill.enabled) return;

    return startChatComposerSkillSelection({
      getEditor: () => senderRef.current,
      maxAttempts: SKILL_SELECTION_MAX_INSERT_ATTEMPTS,
      scheduler: {
        cancelFrame: window.cancelAnimationFrame.bind(window),
        requestFrame: window.requestAnimationFrame.bind(window),
      },
      skill,
      onConfirmed: () => {
        if (consumedSkillSelectionRequestIdRef.current === skillSelectionRequest.requestId) return;
        // Consume only after the tag survives Sender initialization and a full frame.
        consumedSkillSelectionRequestIdRef.current = skillSelectionRequest.requestId;
        setSelectedSkills((current) => (current.some((item) => item.id === skill.id) ? current : [...current, skill]));
        commandController.focusComposer();
        onSkillSelectionRequestConsumed?.(skillSelectionRequest.requestId);
      },
    });
  }, [
    commandController.focusComposer,
    onSkillSelectionRequestConsumed,
    skillSelectionRequest,
    skills,
  ]);

  useEffect(() => {
    if (!imageAttachmentRequest || consumedImageAttachmentRequestIdRef.current === imageAttachmentRequest.requestId) return;
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

  const selectSkill = (skill?: RuntimeSkillSummary) => {
    const command = commandController.slashCommand
      ?? parseSlashCommand(draft, commandController.commandCursorOffset);
    if (!skill || (!command && !commandController.forcedSlashMenuOpen)) return;
    senderRef.current?.insert?.(
      [createSelectedSkillSlot(skill), createTextSlot(' ')],
      'cursor',
      command ? draft.slice(command.start, command.end) : undefined,
      true,
    );
    commandController.acceptSlashSelection();
    setSelectedSkills((current) => (current.some((item) => item.id === skill.id) ? current : [...current, skill]));
  };

  const handleChange = (value: string, _event?: unknown, slotConfig?: SlotConfigType[]) => {
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
      // 先聚焦，让 Ant Design X 能够创建用于插入槽位的有效选区。
      editor.focus({ cursor: 'end', preventScroll: true });
      editor.insert([createTextSlot(syncPlan.value)], 'end', undefined, true);
    }
  }, [draft]);

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
      selectSkill(item.skill);
      return;
    }
    commandController.closeSlashMenu();
    if (item.kind === 'action' && item.disabled) {
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'memory-mode') {
      if (!item.disabled) void onThreadMemoryModeChange(nextThreadMemoryMode(memoryMode));
      commandController.focusComposer();
      return;
    }
    const command = commandController.slashCommand
      ?? parseSlashCommand(draft, commandController.commandCursorOffset);
    const nextDraft = command ? `${draft.slice(0, command.start)}${draft.slice(command.end)}`.trimStart() : draft;
    commandController.clearSlashDismissal();
    if (command) {
      senderRef.current?.insert?.([createTextSlot('')], 'cursor', draft.slice(command.start, command.end), true);
    }
    onDraftChange(nextDraft);
    if (item.kind === 'model') {
      modeController.openModelPicker();
      return;
    }
    if (item.kind === 'action' && item.type === 'plan') {
      modeController.togglePlanMode();
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'collaboration') {
      void onSetMultiAgentEnabled(!multiAgentEnabled);
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'goal') {
      modeController.toggleGoalMode();
      commandController.focusComposer();
      return;
    }
    if (item.kind === 'action' && item.type === 'usage' && !item.disabled) {
      modeController.toggleUsagePanel();
      return;
    }
    if (item.kind === 'action' && item.type === 'review' && !item.disabled) {
      void onStartThreadReview();
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
    if (queuedTurnEdit.editing) {
      await queuedTurnEdit.submit(value ?? draft);
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
    if (!files.length || submitting || queuedTurnEdit.retrieving) return;
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
    <div className={`chat-sender ${starter ? 'chat-sender--starter' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept={chatAttachmentAccept}
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
        usagePanel={{
          open: modeController.usagePanelOpen && Boolean(currentThread),
          threadUsage,
          onClose: modeController.closeUsagePanel,
        }}
      />
      <ChatSendQueue
        disabled={submitting || queuedTurnEdit.editing}
        editDisabled={queuedTurnEdit.editDisabled}
        hasActiveTurn={Boolean(activeTurnId)}
        items={queuedTurnEdit.visibleQueuedTurnInputs}
        onDelete={deleteQueuedTurnInput}
        onEdit={queuedTurnEdit.edit}
        onSendNow={sendQueuedTurnInputNow}
      />
      {currentGoal ? (
        <ChatGoalStatusBar
          key={`${currentGoal.threadId}:${currentGoal.id}`}
          activeTurnStartedAt={activeGoalTurnStartedAt}
          goal={currentGoal}
          onClearGoal={onClearThreadGoal}
          onUpdateGoal={onUpdateThreadGoal}
        />
      ) : null}
      <Sender
        ref={senderRef}
        value={draft}
        disabled={submitting || queuedTurnEdit.retrieving}
        slotConfig={initialSlotConfigRef.current}
        loading={Boolean(activeTurnId)}
        placeholder={placeholder ?? t('chat.composer.placeholder')}
        autoSize={{ minRows: 2, maxRows: 6 }}
        suffix={false}
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
            attachmentControl={{
              disabled: attachmentLimitReached || submitting || queuedTurnEdit.retrieving,
              onOpen: () => fileInputRef.current?.click(),
            }}
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
              planEnabled: modeController.planModeEnabled,
              onClearGoal: modeController.clearGoalMode,
              onDisableCollaboration: () => void onSetMultiAgentEnabled(false),
              onDisablePlan: modeController.disablePlanMode,
            }}
            modelOpenSignal={modeController.modelOpenSignal}
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
            onSelectModel={onSelectModel}
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
