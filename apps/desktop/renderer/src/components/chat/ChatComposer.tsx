import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Sender } from '@ant-design/x';
import type { SlotConfigType } from '@ant-design/x/es/sender';
import { Button, Dropdown } from 'antd';
import { ArrowUp, Boxes, Check, CircleGauge, Paperclip, Plus, Sparkles, Square, X } from 'lucide-react';
import type { DesktopRuntimeClient, RuntimeConfigState, RuntimeSkillSummary, RuntimeThread, RuntimeThreadMemoryMode, RuntimeUsageResponse, WorkspaceEntrySearchItem, WorkspaceEntrySearchResponse, WorkspaceProject } from '@setsuna-desktop/contracts';
import { ChatAttachmentTray } from './ChatAttachmentTray.js';
import { ChatApprovalPolicyMenu } from './ChatApprovalPolicyMenu.js';
import { ProjectEntryCommandMenu } from './ChatCommandMenus.js';
import { ChatModelPicker } from './ChatModelPicker.js';
import { ChatSlashCommandMenu, type SlashCommandMenuItem } from './ChatSlashCommandMenu.js';
import { createChatComposerSendOptions, type ChatComposerSendOptions } from './chatComposerSendOptions.js';
import {
  applyComposerCursorOffsetAdjustments,
  composerCursorOffsetAdjustmentAttribute,
} from './chatComposerCursorOffset.js';
import { createComposerDraftSyncPlan } from './chatComposerDraftSync.js';
import { createTextSlot, createWorkspaceMentionInsertion, createWorkspaceMentionSlots } from './chatComposerSlots.js';
import { chatAttachmentAccept } from './chatAttachments.js';
import type { ChatContextTokenUsage } from './chatContextUsage.js';
import { parseMentionCommand, parseSlashCommand, skillDisplayText } from './chatCommandUtils.js';
import { useChatAttachments } from './useChatAttachments.js';
import type { ChatImageAttachmentOutcome, ChatImageAttachmentRequest, ChatSkillSelectionRequest, ChatWorkspaceMentionRequest } from '../../types/app.js';

type SlashQuickAction = Exclude<SlashCommandMenuItem, { kind: 'skill' }>;
type ActiveThinkingConfig = {
  supported: boolean;
  efforts: string[];
  defaultEffort: string;
};
const EMPTY_SLOT_CONFIG: SlotConfigType[] = [];

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
  imageAttachmentRequest,
  skillSelectionRequest,
  workspaceMentionRequest,
  skills,
  threadUsage,
  starter = false,
  placeholder = '输入消息（输入 / 唤起命令）',
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onDraftChange,
  onSelectModel,
  onSearchProjectEntries,
  onOpenSideChat,
  onSetMultiAgentEnabled,
  onSend,
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
  imageAttachmentRequest?: ChatImageAttachmentRequest | null;
  skillSelectionRequest?: ChatSkillSelectionRequest | null;
  workspaceMentionRequest?: ChatWorkspaceMentionRequest | null;
  skills: RuntimeSkillSummary[];
  threadUsage: RuntimeUsageResponse | null;
  starter?: boolean;
  placeholder?: string;
  threadMemoryMode?: RuntimeThreadMemoryMode;
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onDraftChange: (value: string) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onOpenSideChat?: () => void;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onSend: (value?: string, options?: ChatComposerSendOptions) => Promise<boolean>;
  onStartThreadReview: () => void | Promise<unknown>;
  onThreadMemoryModeChange: (mode: RuntimeThreadMemoryMode) => void | Promise<void>;
  onImageAttachmentRequestConsumed?: (requestId: number, outcome: ChatImageAttachmentOutcome) => void;
  onSkillSelectionRequestConsumed?: (requestId: number) => void;
  onWorkspaceMentionRequestConsumed?: (requestId: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [dismissedCommandValue, setDismissedCommandValue] = useState('');
  const [dismissedSlashValue, setDismissedSlashValue] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntrySearchItem[]>([]);
  const [focused, setFocused] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelOpenSignal, setModelOpenSignal] = useState(0);
  const [selectedSkills, setSelectedSkills] = useState<RuntimeSkillSummary[]>([]);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState('');
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [goalModeEnabled, setGoalModeEnabled] = useState(false);
  const [usagePanelOpen, setUsagePanelOpen] = useState(false);
  const [slashMenuForcedOpen, setSlashMenuForcedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cursorOffset, setCursorOffset] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const senderRef = useRef<ComponentRef<typeof Sender>>(null);
  const lastEditorDraftRef = useRef(draft);
  const consumedImageAttachmentRequestIdRef = useRef<number | null>(null);
  const consumedSkillSelectionRequestIdRef = useRef<number | null>(null);
  const consumedWorkspaceMentionRequestIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const initialSlotConfigRef = useRef<SlotConfigType[]>(draft ? [createTextSlot(draft)] : EMPTY_SLOT_CONFIG);
  const commandCursorOffset = cursorOffset ?? draft.length;
  const mentionCommand = useMemo(() => parseMentionCommand(draft, commandCursorOffset), [commandCursorOffset, draft]);
  const slashCommand = useMemo(() => parseSlashCommand(draft, commandCursorOffset), [commandCursorOffset, draft]);
  const mentionQuery = mentionCommand?.query ?? '';
  const commandOpen = Boolean(focused && mentionCommand && dismissedCommandValue !== draft);
  const skillCommandOpen = Boolean(focused && !commandOpen && (slashCommand ? dismissedSlashValue !== draft : slashMenuForcedOpen));
  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map((skill) => skill.id)), [selectedSkills]);
  const skillQuery = slashCommand?.query.trim().toLowerCase() ?? '';
  const supportsImageInput = activeModelSupportsImages(config);
  const {
    addExistingImage,
    addFiles: addAttachmentFiles,
    atLimit: attachmentLimitReached,
    beginSend: beginAttachmentSend,
    busy: attachmentsBusy,
    items: attachmentItems,
    remove: removeAttachment,
    sendableAttachments,
    settleSend: settleAttachmentSend,
  } = useChatAttachments({ client, supportsImageInput });
  const thinkingConfig = useMemo(() => activeModelThinkingConfig(config), [config]);
  const attachmentOnlyReady = sendableAttachments.length > 0 && !draft.trim();
  const activeSteerReady = Boolean(activeTurnId && (draft.trim() || sendableAttachments.length));
  const contextCompactPercent = Math.round(Number(contextUsage.percent || 0));
  const memoryMode = threadMemoryMode ?? 'enabled';
  const memoryGenerationEnabled = config?.memory?.generateMemories ?? config?.memoryEnabled ?? true;
  const multiAgentEnabled = config?.features?.multi_agent === true || config?.features?.multi_agent_v2 === true;
  const activeGoal = currentThread?.goal?.status === 'active' ? currentThread.goal : null;
  const goalEnabled = goalModeEnabled || Boolean(activeGoal);
  const hasComposerAttachments = attachmentItems.some((item) => item.status !== 'removing');
  const slashEntries = useMemo(() => {
    const actions: SlashQuickAction[] = [
      {
        key: 'model',
        kind: 'model',
        title: '模型',
        description: activeModelName(config) ?? '选择本地配置模型',
        scope: '本地',
      },
      {
        key: 'plan',
        kind: 'action',
        type: 'plan',
        title: '计划模式',
        description: activeTurnId
          ? planModeEnabled
            ? '已开启：下一轮先给出计划，待确认后执行'
            : '为当前回复结束后的下一轮开启计划模式'
          : planModeEnabled
            ? '已开启：模型先给出计划，待确认后执行'
            : '模型先给出计划，待确认后再执行',
        checked: planModeEnabled,
        scope: activeTurnId ? '下一轮' : planModeEnabled ? '已开启' : '本地',
      },
      {
        key: 'collaboration',
        kind: 'action',
        type: 'collaboration',
        title: '协作模式',
        description: multiAgentEnabled ? '已开启：允许 Agent 创建和调度子 Agent' : '允许 Agent 把任务拆给子 Agent 并汇总结果',
        checked: multiAgentEnabled,
        scope: multiAgentEnabled ? '已开启' : '本地',
      },
      {
        key: 'goal',
        kind: 'action',
        type: 'goal',
        title: '目标模式',
        description: !activeGoal && hasComposerAttachments
          ? '请先移除附件；新目标暂不支持携带附件'
          : activeGoal
          ? `已开启：${activeGoal.objective}`
          : activeTurnId
            ? goalModeEnabled
              ? '已开启：下一轮将设为线程目标'
              : '把当前回复结束后的下一轮设为持续目标'
          : goalModeEnabled
            ? '已开启：下一条消息将设为线程目标'
            : '把下一条消息设为持续目标并开始执行',
        checked: goalEnabled,
        disabled: !activeGoal && hasComposerAttachments,
        scope: activeGoal || (!activeTurnId && goalEnabled) ? '已开启' : activeTurnId ? '下一轮' : '当前线程',
      },
      {
        key: 'usage',
        kind: 'action',
        type: 'usage',
        title: '用量与诊断',
        description: currentThread ? '查看当前线程的 Token、调用次数和最近一轮诊断' : '请先打开一个对话',
        disabled: !currentThread,
        scope: '当前线程',
      },
      {
        key: 'side-chat',
        kind: 'action',
        type: 'side-chat',
        title: '侧边任务',
        description: '新建一个独立的侧边对话任务',
        disabled: !onOpenSideChat,
        scope: '右侧栏',
      },
      {
        key: 'review',
        kind: 'action',
        type: 'review',
        title: '审查当前改动',
        description: activeTurnId ? '请等待当前回复结束后再开始审查' : activeProject ? '让 Agent 审查当前项目的未提交改动' : '请先选择项目',
        disabled: Boolean(activeTurnId) || !activeProject,
        scope: '当前项目',
      },
      {
        key: 'memory-mode',
        kind: 'action',
        type: 'memory-mode',
        title: '记忆',
        description: threadMemoryModeDescription(memoryMode, memoryGenerationEnabled),
        disabled: !memoryGenerationEnabled,
        checked: memoryGenerationEnabled && memoryMode === 'enabled',
        scope: threadMemoryModeScope(memoryMode, memoryGenerationEnabled),
      },
      {
        key: 'compact-context',
        kind: 'action',
        type: 'compact-context',
        title: '压缩上下文',
        description: activeTurnId
          ? '请等待当前回复结束后再压缩上下文'
          : contextCompacting
            ? '正在压缩上下文'
            : canClearContext
              ? `压缩此会话的上下文${contextCompactPercent > 0 ? `（已使用 ${contextCompactPercent}%）` : ''}`
              : '当前对话暂无可压缩内容',
        disabled: Boolean(activeTurnId) || !canClearContext || contextCompacting,
        loading: contextCompacting,
        progressPercent: contextCompactPercent,
        scope: '本地',
      },
      {
        key: 'clear-context',
        kind: 'action',
        type: 'clear-context',
        title: '清空上下文',
        description: activeTurnId ? '请等待当前回复结束后再清空上下文' : canClearContext ? '清除当前对话上下文' : '当前对话暂无上下文',
        disabled: Boolean(activeTurnId) || !canClearContext,
        scope: '本地',
      },
    ];
    const visibleActions = actions.filter((action) => {
      if (!skillQuery) return true;
      return `${action.key} ${action.title} ${action.description ?? ''} ${action.scope ?? ''}`.toLowerCase().includes(skillQuery);
    });
    const visibleSkills = skills
      .filter((skill) => skill.enabled && !selectedSkillIds.has(skill.id))
      .filter((skill) => {
        if (!skillQuery) return true;
        return `${skill.name} ${skill.id} ${skill.description ?? ''}`.toLowerCase().includes(skillQuery);
      })
      .slice(0, Math.max(0, 8 - visibleActions.length))
      .map<SlashCommandMenuItem>((skill) => ({ key: `skill:${skill.id}`, kind: 'skill', skill }));
    return [...visibleActions, ...visibleSkills];
  }, [activeGoal, activeProject, activeTurnId, canClearContext, config, contextCompactPercent, contextCompacting, currentThread, goalEnabled, goalModeEnabled, hasComposerAttachments, memoryGenerationEnabled, memoryMode, multiAgentEnabled, onOpenSideChat, planModeEnabled, selectedSkillIds, skillQuery, skills]);

  useEffect(() => {
    if (!commandOpen || !activeProject) {
      setEntries([]);
      setLoadError('');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setActiveIndex(0);
    setLoading(true);
    setLoadError('');
    onSearchProjectEntries(mentionQuery)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        if (result.truncated) setLoadError('仅显示部分匹配结果，请继续输入以缩小范围。');
      })
      .catch((unknownError) => {
        if (cancelled) return;
        setEntries([]);
        setLoadError(unknownError instanceof Error ? unknownError.message : '项目文件加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [commandOpen, mentionQuery, onSearchProjectEntries]);

  useEffect(() => {
    if (!focused) return undefined;
    const updateCursorOffset = () => {
      setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null));
    };
    updateCursorOffset();
    document.addEventListener('selectionchange', updateCursorOffset);
    return () => document.removeEventListener('selectionchange', updateCursorOffset);
  }, [focused]);

  useEffect(() => {
    setActiveSkillIndex(0);
  }, [skillQuery]);

  useEffect(() => {
    setGoalModeEnabled(false);
    setUsagePanelOpen(false);
  }, [currentThread?.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    setFocused(true);
    onWorkspaceMentionRequestConsumed?.(workspaceMentionRequest.requestId);
  }, [onWorkspaceMentionRequestConsumed, workspaceMentionRequest]);

  useEffect(() => {
    if (!skillSelectionRequest || consumedSkillSelectionRequestIdRef.current === skillSelectionRequest.requestId) return;
    const skill = skills.find((item) => item.id === skillSelectionRequest.skillId);
    if (!skill || !skill.enabled) return;
    consumedSkillSelectionRequestIdRef.current = skillSelectionRequest.requestId;
    const alreadySelected = selectedSkills.some((item) => item.id === skill.id);
    if (!alreadySelected) {
      setSelectedSkills((current) => (current.some((item) => item.id === skill.id) ? current : [...current, skill]));
      senderRef.current?.insert?.([createSelectedSkillSlot(skill), createTextSlot(' ')], 'start', undefined, true);
    }
    setFocused(true);
    onSkillSelectionRequestConsumed?.(skillSelectionRequest.requestId);
  }, [onSkillSelectionRequestConsumed, selectedSkills, skillSelectionRequest, skills]);

  useEffect(() => {
    if (!imageAttachmentRequest || consumedImageAttachmentRequestIdRef.current === imageAttachmentRequest.requestId) return;
    consumedImageAttachmentRequestIdRef.current = imageAttachmentRequest.requestId;
    const outcome = addExistingImage(imageAttachmentRequest.attachment);
    if (outcome === 'added') {
      setGoalModeEnabled(false);
      setFocused(true);
    }
    onImageAttachmentRequestConsumed?.(imageAttachmentRequest.requestId, outcome);
  }, [addExistingImage, imageAttachmentRequest, onImageAttachmentRequestConsumed]);

  useEffect(() => {
    if (!thinkingConfig.supported) {
      setThinkingEnabled(false);
      if (thinkingEffort) setThinkingEffort('');
      return;
    }
    if (!thinkingEffort || !thinkingConfig.efforts.includes(thinkingEffort)) {
      setThinkingEffort(thinkingConfig.defaultEffort);
    }
  }, [thinkingConfig.defaultEffort, thinkingConfig.efforts, thinkingConfig.supported, thinkingEffort]);

  const selectEntry = (entry?: WorkspaceEntrySearchItem) => {
    const command = mentionCommand ?? parseMentionCommand(draft, commandCursorOffset);
    if (!command || !entry) return;
    senderRef.current?.insert?.(
      createWorkspaceMentionSlots(entry),
      'cursor',
      draft.slice(command.start, command.end),
      true,
    );
    setDismissedCommandValue('');
    setFocused(true);
  };

  const selectSkill = (skill?: RuntimeSkillSummary) => {
    const command = slashCommand ?? parseSlashCommand(draft, commandCursorOffset);
    if (!skill || (!command && !slashMenuForcedOpen)) return;
    senderRef.current?.insert?.(
      [createSelectedSkillSlot(skill), createTextSlot(' ')],
      'cursor',
      command ? draft.slice(command.start, command.end) : undefined,
      true,
    );
    setDismissedSlashValue('');
    setSlashMenuForcedOpen(false);
    setFocused(true);
    setSelectedSkills((current) => (current.some((item) => item.id === skill.id) ? current : [...current, skill]));
  };

  const handleChange = (value: string, _event?: unknown, slotConfig?: SlotConfigType[]) => {
    if (dismissedCommandValue && dismissedCommandValue !== value) setDismissedCommandValue('');
    if (dismissedSlashValue && dismissedSlashValue !== value) setDismissedSlashValue('');
    if (slashMenuForcedOpen) setSlashMenuForcedOpen(false);
    setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null));
    syncSelectedSkillsFromSlots(slotConfig);
    lastEditorDraftRef.current = value;
    onDraftChange(value);
  };

  useEffect(() => {
    const editor = senderRef.current;
    if (!editor) return;
    const syncPlan = createComposerDraftSyncPlan(draft, lastEditorDraftRef.current, editor.getValue().value);
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
    if (skillCommandOpen) return handleSkillKeyDown(event);
    if (!commandOpen) {
      return submitActiveSteerFromKeyboard(event);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissedCommandValue(draft);
      return false;
    }
    if (!entries.length) return undefined;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => (current + 1) % entries.length);
      return false;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => (current - 1 + entries.length) % entries.length);
      return false;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      selectEntry(entries[activeIndex]);
      return false;
    }
    return submitActiveSteerFromKeyboard(event);
  };

  const handleSkillKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissedSlashValue(draft);
      setSlashMenuForcedOpen(false);
      return false;
    }
    if (!slashEntries.length) return undefined;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setActiveSkillIndex((current) => (current + 1) % slashEntries.length);
      return false;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setActiveSkillIndex((current) => (current - 1 + slashEntries.length) % slashEntries.length);
      return false;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      selectSlashEntry(slashEntries[activeSkillIndex]);
      return false;
    }
    return undefined;
  };

  const selectSlashEntry = (item?: SlashCommandMenuItem) => {
    if (!item) return;
    if (item.kind === 'skill') {
      selectSkill(item.skill);
      return;
    }
    setSlashMenuForcedOpen(false);
    if (item.kind === 'action' && item.disabled) {
      setFocused(true);
      return;
    }
    if (item.kind === 'action' && item.type === 'memory-mode') {
      if (!item.disabled) void onThreadMemoryModeChange(nextThreadMemoryMode(memoryMode));
      setFocused(true);
      return;
    }
    const command = slashCommand ?? parseSlashCommand(draft, commandCursorOffset);
    const nextDraft = command ? `${draft.slice(0, command.start)}${draft.slice(command.end)}`.trimStart() : draft;
    setDismissedSlashValue('');
    if (command) {
      senderRef.current?.insert?.([createTextSlot('')], 'cursor', draft.slice(command.start, command.end), true);
    }
    onDraftChange(nextDraft);
    if (item.kind === 'model') {
      setModelOpenSignal((value) => value + 1);
      return;
    }
    if (item.kind === 'action' && item.type === 'plan') {
      setPlanModeEnabled((value) => !value);
      setFocused(true);
      return;
    }
    if (item.kind === 'action' && item.type === 'collaboration') {
      void onSetMultiAgentEnabled(!multiAgentEnabled);
      setFocused(true);
      return;
    }
    if (item.kind === 'action' && item.type === 'goal') {
      if (activeGoal) {
        void onClearThreadGoal();
        setGoalModeEnabled(false);
      } else {
        setGoalModeEnabled((value) => !value);
      }
      setFocused(true);
      return;
    }
    if (item.kind === 'action' && item.type === 'usage' && !item.disabled) {
      setUsagePanelOpen((value) => !value);
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
    const steering = Boolean(activeTurnId);
    const sendOptions = createChatComposerSendOptions({
      attachments: sendableAttachments,
      goalModeEnabled,
      planModeEnabled,
      selectedSkillIds: selectedSkills.map((skill) => skill.id),
      steering,
      supportsImageInput,
      thinkingEffort,
      thinkingEnabled,
      thinkingSupported: thinkingConfig.supported,
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
    if (!steering) {
      setPlanModeEnabled(false);
      setGoalModeEnabled(false);
    }
    senderRef.current?.clear?.();
  };

  const addFiles = (files: File[]) => {
    if (!files.length || submitting) return;
    // 目前创建目标时只保存目标描述。接收文件前先关闭目标模式，避免资源被静默丢弃。
    setGoalModeEnabled(false);
    void addAttachmentFiles(files);
  };

  const submitActiveSteerFromKeyboard = (event: ReactKeyboardEvent) => {
    if (!activeSteerReady || !isPlainEnter(event)) return undefined;
    event.preventDefault();
    event.stopPropagation();
    void submitDraft(draft);
    return false;
  };

  const syncSelectedSkillsFromSlots = (slotConfig: SlotConfigType[] | undefined) => {
    const selectedSlotKeys = new Set(
      (slotConfig ?? [])
        .map((slot) => slot.key)
        .filter((key): key is string => typeof key === 'string' && key.startsWith(selectedSkillSlotPrefix)),
    );
    setSelectedSkills((current) => current.filter((skill) => selectedSlotKeys.has(selectedSkillSlotKey(skill.id))));
  };

  const openSlashMenu = () => {
    setActiveSkillIndex(0);
    setDismissedSlashValue('');
    setSlashMenuForcedOpen((open) => !open);
    setFocused(true);
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
          setFocused(true);
        }}
      />
      {commandOpen ? (
        <ProjectEntryCommandMenu
          activeIndex={activeIndex}
          entries={entries}
          hasProject={Boolean(activeProject)}
          loadError={loadError}
          loading={loading}
          onHover={setActiveIndex}
          onSelect={selectEntry}
        />
      ) : null}
      {skillCommandOpen ? (
        <ChatSlashCommandMenu
          activeIndex={activeSkillIndex}
          items={slashEntries}
          onHover={setActiveSkillIndex}
          onSelect={selectSlashEntry}
        />
      ) : null}
      {usagePanelOpen && currentThread ? (
        <ChatUsagePanel threadUsage={threadUsage} onClose={() => setUsagePanelOpen(false)} />
      ) : null}
      <Sender
        ref={senderRef}
        value={draft}
        disabled={submitting}
        slotConfig={initialSlotConfigRef.current}
        loading={Boolean(activeTurnId)}
        placeholder={placeholder}
        autoSize={{ minRows: 2, maxRows: 6 }}
        suffix={false}
        onBlur={() => {
          setFocused(false);
          setSlashMenuForcedOpen(false);
        }}
        onChange={handleChange}
        onFocus={() => {
          setFocused(true);
          setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null));
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={() => setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null))}
        onPasteFile={(files) => {
          addFiles(Array.from(files));
          setFocused(true);
        }}
        onSubmit={submitDraft}
        onCancel={onCancelActiveTurn}
        header={
          <ChatAttachmentTray disabled={submitting} items={attachmentItems} onRemove={removeAttachment} />
        }
        footer={(actions) => (
          <div className="chat-sender__footer">
            <div className="chat-sender__left-actions">
              <button
                className={`chat-sender-icon-button chat-sender-command-button ${slashMenuForcedOpen ? 'is-active' : ''}`}
                type="button"
                aria-label="打开命令菜单"
                title="打开命令菜单"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openSlashMenu}
              >
                <Plus size={14} />
              </button>
              <ChatThinkingMenu
                enabled={thinkingEnabled}
                menuOpen={thinkingMenuOpen}
                thinkingConfig={thinkingConfig}
                value={thinkingEffort}
                onEnabledChange={setThinkingEnabled}
                onMenuOpenChange={setThinkingMenuOpen}
                onValueChange={setThinkingEffort}
              />
              <ChatApprovalPolicyMenu
                policy={config?.approvalPolicy ?? 'on-request'}
                onChange={onApprovalPolicyChange}
              />
              {planModeEnabled ? (
                <ChatModeBadge label={activeTurnId ? '计划（下一轮）' : '计划'} onClose={() => setPlanModeEnabled(false)} />
              ) : null}
              {multiAgentEnabled ? <ChatModeBadge label="协作" onClose={() => void onSetMultiAgentEnabled(false)} /> : null}
              {goalEnabled ? <ChatModeBadge label={activeGoal && activeTurnId ? '目标进行中' : activeTurnId ? '目标（下一轮）' : '目标已开启'} onClose={() => {
                if (activeGoal) void onClearThreadGoal();
                setGoalModeEnabled(false);
              }} /> : null}
            </div>
            <div className="chat-sender__right-actions">
              <button
                className="chat-sender-icon-button"
                type="button"
                aria-label="上传附件"
                title="上传图片、PDF 或 DOCX"
                disabled={attachmentLimitReached || submitting}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={13} />
              </button>
              <span className="chat-sender-divider" aria-hidden="true" />
              <ChatModelPicker
                config={config}
                contextCompacting={contextCompacting}
                contextUsage={contextUsage}
                openSignal={modelOpenSignal}
                onSelect={onSelectModel}
              />
              <span className="chat-sender-divider" aria-hidden="true" />
              {activeSteerReady ? (
                <button className="chat-sender-attachment-submit" type="button" aria-label="插入引导" title="插入引导" disabled={attachmentsBusy || submitting} onClick={() => void submitDraft(draft)}>
                  <ArrowUp size={16} />
                </button>
              ) : activeTurnId ? (
                <button className="chat-sender-stop" type="button" aria-label="停止生成" title="停止生成" onClick={onCancelActiveTurn}>
                  <Square size={11} />
                </button>
              ) : attachmentOnlyReady ? (
                <button className="chat-sender-attachment-submit" type="button" aria-label="发送" disabled={attachmentsBusy || submitting} onClick={() => void submitDraft(draft)}>
                  <ArrowUp size={16} />
                </button>
              ) : (
                actions
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}

function ChatModeBadge({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button className="chat-sender-plan-badge" type="button" aria-label={`关闭${label}`} title={`关闭${label}`} onClick={onClose}>
      <span className="chat-sender-plan-badge__dot" aria-hidden="true" />
      <span className="chat-sender-plan-badge__label">{label}</span>
      <X className="chat-sender-plan-badge__close" size={11} aria-hidden="true" />
    </button>
  );
}

function ChatUsagePanel({
  threadUsage,
  onClose,
}: {
  threadUsage: RuntimeUsageResponse | null;
  onClose: () => void;
}) {
  const summary = threadUsage?.summary;
  return (
    <section className="chat-usage-panel" aria-label="当前线程用量与诊断">
      <header>
        <span><CircleGauge size={14} /> 用量与诊断</span>
        <button type="button" aria-label="关闭用量面板" onClick={onClose}><X size={13} /></button>
      </header>
      <div className="chat-usage-panel__metrics">
        <span>总计<strong>{formatUsageTokens(summary?.totalTokens ?? 0)}</strong></span>
        <span>输入<strong>{formatUsageTokens(summary?.inputTokens ?? 0)}</strong></span>
        <span>输出<strong>{formatUsageTokens(summary?.outputTokens ?? 0)}</strong></span>
        <span>调用<strong>{summary?.recordCount ?? 0}</strong></span>
      </div>
    </section>
  );
}

function formatUsageTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function nextThreadMemoryMode(mode: RuntimeThreadMemoryMode): RuntimeThreadMemoryMode {
  return mode === 'enabled' ? 'disabled' : 'enabled';
}

function threadMemoryModeDescription(mode: RuntimeThreadMemoryMode, globalGenerationEnabled: boolean): string {
  if (!globalGenerationEnabled) return '全局记忆生成已关闭';
  if (mode === 'polluted') return '已因外部上下文暂停，选择后重新启用';
  return mode === 'enabled' ? '对话结束后允许提炼长期记忆' : '当前对话不会写入新的长期记忆';
}

function threadMemoryModeScope(mode: RuntimeThreadMemoryMode, globalGenerationEnabled: boolean): string {
  if (!globalGenerationEnabled) return '全局关闭';
  return mode === 'enabled' ? '已开启' : '已暂停';
}

function ChatThinkingMenu({
  disabled,
  enabled,
  menuOpen,
  thinkingConfig,
  value,
  onEnabledChange,
  onMenuOpenChange,
  onValueChange,
}: {
  disabled?: boolean;
  enabled: boolean;
  menuOpen: boolean;
  thinkingConfig: ActiveThinkingConfig;
  value: string;
  onEnabledChange: (enabled: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
}) {
  const hasEfforts = thinkingConfig.efforts.length > 0;
  const currentEffort = value && thinkingConfig.efforts.includes(value) ? value : thinkingConfig.defaultEffort;

  if (!thinkingConfig.supported) return null;

  const thinkingLabel = enabled ? (currentEffort ? formatThinkingEffort(currentEffort) : '思考') : '';
  const selectedThinkingKey = enabled && currentEffort ? currentEffort : 'off';
  const renderThinkingMenuItem = (label: string, active: boolean) => (
    <span className="chat-thinking-menu__item">
      <span className="chat-thinking-menu__icon" />
      <span>{label}</span>
      <span className="chat-thinking-menu__check">{active ? <Check size={13} /> : null}</span>
    </span>
  );
  const items: NonNullable<ComponentProps<typeof Dropdown>['menu']>['items'] = [
    {
      key: 'off',
      label: renderThinkingMenuItem('关闭', !enabled),
    },
    ...thinkingConfig.efforts.map((effort) => ({
      key: effort,
      label: renderThinkingMenuItem(formatThinkingEffort(effort), enabled && currentEffort === effort),
    })),
  ];
  const thinkingSwitch = (
    <Button
      type="text"
      size="small"
      className="chat-thinking-switch"
      disabled={disabled}
      aria-pressed={enabled}
      onClick={hasEfforts ? undefined : () => onEnabledChange(!enabled)}
    >
      <Sparkles className="chat-thinking-switch__icon" size={13} />
      {thinkingLabel ? <span className="chat-thinking-switch__label">{thinkingLabel}</span> : null}
    </Button>
  );

  if (!hasEfforts) return thinkingSwitch;

  return (
    <Dropdown
      rootClassName="chat-thinking-menu-root"
      trigger={['click']}
      placement="topLeft"
      // Windows“最佳性能”模式禁用界面过渡事件时，此功能也要保持可用。
      transitionName=""
      disabled={disabled}
      open={menuOpen}
      menu={{
        items,
        selectedKeys: [selectedThinkingKey],
        onClick: ({ key }) => {
          if (key === 'off') {
            onEnabledChange(false);
          } else {
            onValueChange(key);
            onEnabledChange(true);
          }
          onMenuOpenChange(false);
        },
      }}
      onOpenChange={onMenuOpenChange}
    >
      {thinkingSwitch}
    </Dropdown>
  );
}

function formatThinkingEffort(effort: string): string {
  const value = effort.trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '思考';
}

const selectedSkillSlotPrefix = 'skill:';

function selectedSkillSlotKey(skillId: string): string {
  return `${selectedSkillSlotPrefix}${skillId}`;
}

function createSelectedSkillSlot(skill: RuntimeSkillSummary): SlotConfigType {
  const tokenText = skillDisplayText(skill);
  return {
    type: 'tag',
    key: selectedSkillSlotKey(skill.id),
    props: {
      label: (
        <span className="chat-skill-slot" title={skill.description || skill.id}>
          <Boxes size={13} />
          <span className="chat-skill-slot__name">{tokenText}</span>
        </span>
      ),
      value: tokenText,
    },
    formatResult: () => tokenText,
  };
}

function readComposerCursorOffset(inputElement?: HTMLElement | null): number | null {
  if (!inputElement) return null;
  const ownerWindow = inputElement.ownerDocument.defaultView;
  if (
    ownerWindow
    && (inputElement instanceof ownerWindow.HTMLTextAreaElement || inputElement instanceof ownerWindow.HTMLInputElement)
  ) {
    return inputElement.selectionStart ?? null;
  }

  const selection = inputElement.ownerDocument.getSelection();
  if (!selection?.focusNode || selection.rangeCount === 0 || !inputElement.contains(selection.focusNode)) return null;
  const range = inputElement.ownerDocument.createRange();
  range.selectNodeContents(inputElement);
  range.setEnd(selection.focusNode, selection.focusOffset);
  const visibleOffset = range.toString().length;
  // 提及标签会省略仍保留在提交值中的标记和父路径。
  const offsetAdjustments = Array.from(
    range.cloneContents().querySelectorAll<HTMLElement>(`[${composerCursorOffsetAdjustmentAttribute}]`),
    (element) => element.getAttribute(composerCursorOffsetAdjustmentAttribute),
  );
  return applyComposerCursorOffsetAdjustments(visibleOffset, offsetAdjustments);
}

function activeModelName(config: RuntimeConfigState | null): string | null {
  const provider = activeProviderFromConfig(config);
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  return model?.name ?? null;
}

function activeModelSupportsImages(config: RuntimeConfigState | null): boolean {
  const provider = activeProviderFromConfig(config);
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  return Boolean(model?.supportsImages);
}

function isPlainEnter(event: ReactKeyboardEvent): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !nativeEvent.isComposing;
}

function activeModelThinkingConfig(config: RuntimeConfigState | null): ActiveThinkingConfig {
  const provider = activeProviderFromConfig(config);
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  const efforts = normalizeThinkingEfforts(model?.thinkingEfforts);
  const defaultEffort = typeof model?.defaultThinkingEffort === 'string' && efforts.includes(model.defaultThinkingEffort.trim())
    ? model.defaultThinkingEffort.trim()
    : efforts[0] ?? '';
  return {
    supported: Boolean(model?.thinkingEnabled),
    efforts,
    defaultEffort,
  };
}

function activeProviderFromConfig(config: RuntimeConfigState | null): RuntimeConfigState['providers'][number] | undefined {
  if (!config) return undefined;
  return config.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled)
    ?? config.providers.find((provider) => provider.enabled)
    ?? config.providers[0];
}

function normalizeThinkingEfforts(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const efforts: string[] = [];
  for (const rawValue of rawValues) {
    const effort = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    efforts.push(effort);
  }
  return efforts;
}
