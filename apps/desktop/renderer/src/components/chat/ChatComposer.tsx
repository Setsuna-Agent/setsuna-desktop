import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Sender } from '@ant-design/x';
import type { SlotConfigType } from '@ant-design/x/es/sender';
import { Button, Dropdown } from 'antd';
import { ArrowUp, Boxes, Check, Paperclip, Sparkles, Square, X } from 'lucide-react';
import type { RuntimeConfigState, RuntimeMessageAttachment, RuntimeSkillSummary, RuntimeThreadMemoryMode, WorkspaceEntrySearchItem, WorkspaceProject } from '@setsuna-desktop/contracts';
import { ChatApprovalPolicyMenu } from './ChatApprovalPolicyMenu.js';
import { ProjectEntryCommandMenu } from './ChatCommandMenus.js';
import { ChatModelPicker } from './ChatModelPicker.js';
import { ChatSlashCommandMenu, type SlashCommandMenuItem } from './ChatSlashCommandMenu.js';
import type { ChatContextTokenUsage } from './chatContextUsage.js';
import { entryLabel, parseMentionCommand, parseSlashCommand, skillDisplayText } from './chatCommandUtils.js';
import type { ChatSkillSelectionRequest } from '../../types/app.js';

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
  config,
  canClearContext,
  contextCompacting = false,
  contextUsage,
  draft,
  skillSelectionRequest,
  skills,
  starter = false,
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onCompactContext,
  onClearContext,
  onDraftChange,
  onSelectModel,
  onSearchProjectEntries,
  onSend,
  onThreadMemoryModeChange,
  onSkillSelectionRequestConsumed,
  threadMemoryMode,
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  config: RuntimeConfigState | null;
  canClearContext: boolean;
  contextCompacting?: boolean;
  contextUsage: ChatContextTokenUsage;
  draft: string;
  skillSelectionRequest?: ChatSkillSelectionRequest | null;
  skills: RuntimeSkillSummary[];
  starter?: boolean;
  threadMemoryMode?: RuntimeThreadMemoryMode;
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDraftChange: (value: string) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchItem[]>;
  onSend: (value?: string, options?: { attachments?: RuntimeMessageAttachment[]; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string }) => void;
  onThreadMemoryModeChange: (mode: RuntimeThreadMemoryMode) => void | Promise<void>;
  onSkillSelectionRequestConsumed?: (requestId: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [dismissedCommandValue, setDismissedCommandValue] = useState('');
  const [dismissedSlashValue, setDismissedSlashValue] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntrySearchItem[]>([]);
  const [focused, setFocused] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<RuntimeMessageAttachment[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelOpenSignal, setModelOpenSignal] = useState(0);
  const [selectedSkills, setSelectedSkills] = useState<RuntimeSkillSummary[]>([]);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState('');
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [cursorOffset, setCursorOffset] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const senderRef = useRef<ComponentRef<typeof Sender>>(null);
  const consumedSkillSelectionRequestIdRef = useRef<number | null>(null);
  const initialSlotConfigRef = useRef<SlotConfigType[]>(draft ? [createTextSlot(draft)] : EMPTY_SLOT_CONFIG);
  const commandCursorOffset = cursorOffset ?? draft.length;
  const mentionCommand = useMemo(() => parseMentionCommand(draft, commandCursorOffset), [commandCursorOffset, draft]);
  const slashCommand = useMemo(() => parseSlashCommand(draft, commandCursorOffset), [commandCursorOffset, draft]);
  const mentionQuery = mentionCommand?.query ?? '';
  const commandOpen = Boolean(focused && mentionCommand && dismissedCommandValue !== draft);
  const skillCommandOpen = Boolean(!activeTurnId && focused && slashCommand && dismissedSlashValue !== draft && !commandOpen);
  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map((skill) => skill.id)), [selectedSkills]);
  const skillQuery = slashCommand?.query.trim().toLowerCase() ?? '';
  const supportsImageInput = activeModelSupportsImages(config);
  const thinkingConfig = useMemo(() => activeModelThinkingConfig(config), [config]);
  const attachmentOnlyReady = imageAttachments.length > 0 && !draft.trim();
  const activeSteerReady = Boolean(activeTurnId && (draft.trim() || imageAttachments.length));
  const contextCompactPercent = Math.round(Number(contextUsage.percent || 0));
  const memoryMode = threadMemoryMode ?? 'enabled';
  const memoryGenerationEnabled = config?.memory?.generateMemories ?? config?.memoryEnabled ?? true;
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
        description: contextCompacting
          ? '正在压缩上下文'
          : canClearContext
            ? `压缩此会话的上下文${contextCompactPercent > 0 ? `（已使用 ${contextCompactPercent}%）` : ''}`
            : '当前对话暂无可压缩内容',
        disabled: !canClearContext || contextCompacting,
        loading: contextCompacting,
        progressPercent: contextCompactPercent,
        scope: '本地',
      },
      {
        key: 'clear-context',
        kind: 'action',
        type: 'clear-context',
        title: '清空上下文',
        description: canClearContext ? '清除当前对话上下文' : '当前对话暂无上下文',
        disabled: !canClearContext,
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
  }, [canClearContext, config, contextCompactPercent, contextCompacting, memoryGenerationEnabled, memoryMode, selectedSkillIds, skillQuery, skills]);

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
      .then((nextEntries) => {
        if (cancelled) return;
        setEntries(nextEntries);
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
    if (activeTurnId) return;
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
  }, [activeTurnId, onSkillSelectionRequestConsumed, selectedSkills, skillSelectionRequest, skills]);

  useEffect(() => {
    if (!supportsImageInput && imageAttachments.length) setImageAttachments([]);
  }, [imageAttachments.length, supportsImageInput]);

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
      [createWorkspaceMentionSlot(entry), createTextSlot(' ')],
      'cursor',
      draft.slice(command.start, command.end),
      true,
    );
    setDismissedCommandValue('');
    setFocused(true);
  };

  const selectSkill = (skill?: RuntimeSkillSummary) => {
    const command = slashCommand ?? parseSlashCommand(draft, commandCursorOffset);
    if (!command || !skill) return;
    senderRef.current?.insert?.(
      [createSelectedSkillSlot(skill), createTextSlot(' ')],
      'cursor',
      draft.slice(command.start, command.end),
      true,
    );
    setDismissedSlashValue('');
    setSelectedSkills((current) => (current.some((item) => item.id === skill.id) ? current : [...current, skill]));
  };

  const handleChange = (value: string, _event?: unknown, slotConfig?: SlotConfigType[]) => {
    if (dismissedCommandValue && dismissedCommandValue !== value) setDismissedCommandValue('');
    if (dismissedSlashValue && dismissedSlashValue !== value) setDismissedSlashValue('');
    setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null));
    syncSelectedSkillsFromSlots(slotConfig);
    onDraftChange(value);
  };

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
    if (item.type === 'clear-context' && !item.disabled) {
      onClearContext();
      return;
    }
    if (item.type === 'compact-context' && !item.disabled) {
      onCompactContext();
    }
  };

  const submitDraft = (value?: string) => {
    const steering = Boolean(activeTurnId);
    const thinking = !steering && thinkingConfig.supported && thinkingEnabled;
    onSend(value, {
      attachments: supportsImageInput ? imageAttachments : [],
      ...(!steering ? { skillIds: selectedSkills.map((skill) => skill.id) } : {}),
      ...(!steering ? { thinking } : {}),
      ...(!steering && thinking && thinkingEffort ? { thinkingEffort } : {}),
    });
    setSelectedSkills([]);
    setImageAttachments([]);
    senderRef.current?.clear?.();
  };

  const submitActiveSteerFromKeyboard = (event: ReactKeyboardEvent) => {
    if (!activeSteerReady || !isPlainEnter(event)) return undefined;
    event.preventDefault();
    event.stopPropagation();
    submitDraft(draft);
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

  const addImageFiles = async (files: File[]) => {
    if (!supportsImageInput) return;
    const nextFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!nextFiles.length) return;
    const available = maxImageAttachments - imageAttachments.length;
    if (available <= 0) return;
    const attachments = await Promise.all(nextFiles.slice(0, available).filter((file) => file.size <= maxImageSize).map(readImageAttachment));
    setImageAttachments((current) => [...current, ...attachments]);
    setFocused(true);
  };

  const removeImageAttachment = (id: string) => {
    setImageAttachments((current) => current.filter((item) => item.id !== id));
  };

  return (
    <div className={`chat-sender ${starter ? 'chat-sender--starter' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="chat-sender__file-input"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void addImageFiles(files);
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
      {imageAttachments.length ? (
        <div className="chat-image-attachments" aria-label="图片附件">
          {imageAttachments.map((attachment) => (
            <div className="chat-image-attachment" key={attachment.id}>
              <img src={attachment.url} alt={attachment.name} />
              <span>{attachment.name}</span>
              <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => removeImageAttachment(attachment.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <Sender
        ref={senderRef}
        value={draft}
        slotConfig={initialSlotConfigRef.current}
        loading={Boolean(activeTurnId)}
        placeholder="输入消息（输入 / 唤起命令）"
        autoSize={{ minRows: 2, maxRows: 6 }}
        suffix={false}
        onBlur={() => setFocused(false)}
        onChange={handleChange}
        onFocus={() => {
          setFocused(true);
          setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null));
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={() => setCursorOffset(readComposerCursorOffset(senderRef.current?.inputElement ?? null))}
        onPasteFile={(files) => {
          void addImageFiles(Array.from(files));
        }}
        onSubmit={submitDraft}
        onCancel={onCancelActiveTurn}
        footer={(actions) => (
          <div className="chat-sender__footer">
            <div className="chat-sender__left-actions">
              <ChatThinkingMenu
                disabled={Boolean(activeTurnId)}
                enabled={thinkingEnabled}
                menuOpen={thinkingMenuOpen}
                thinkingConfig={thinkingConfig}
                value={thinkingEffort}
                onEnabledChange={setThinkingEnabled}
                onMenuOpenChange={setThinkingMenuOpen}
                onValueChange={setThinkingEffort}
              />
              <ChatApprovalPolicyMenu
                disabled={Boolean(activeTurnId)}
                policy={config?.approvalPolicy ?? 'on-request'}
                onChange={onApprovalPolicyChange}
              />
            </div>
            <div className="chat-sender__right-actions">
              {supportsImageInput ? (
                <>
                  <button
                    className="chat-sender-icon-button"
                    type="button"
                    aria-label="上传图片"
                    title="上传图片"
                    disabled={Boolean(activeTurnId) || imageAttachments.length >= maxImageAttachments}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={13} />
                  </button>
                  <span className="chat-sender-divider" aria-hidden="true" />
                </>
              ) : null}
              <ChatModelPicker
                config={config}
                contextCompacting={contextCompacting}
                contextUsage={contextUsage}
                disabled={Boolean(activeTurnId)}
                openSignal={modelOpenSignal}
                onSelect={onSelectModel}
              />
              <span className="chat-sender-divider" aria-hidden="true" />
              {activeSteerReady ? (
                <button className="chat-sender-attachment-submit" type="button" aria-label="插入引导" title="插入引导" onClick={() => submitDraft(draft)}>
                  <ArrowUp size={16} />
                </button>
              ) : activeTurnId ? (
                <button className="chat-sender-stop" type="button" aria-label="停止生成" title="停止生成" onClick={onCancelActiveTurn}>
                  <Square size={11} />
                </button>
              ) : attachmentOnlyReady ? (
                <button className="chat-sender-attachment-submit" type="button" aria-label="发送" onClick={() => submitDraft(draft)}>
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

function createWorkspaceMentionSlot(entry: WorkspaceEntrySearchItem): SlotConfigType {
  const displayText = `@${entryDisplayName(entry)}`;
  const resultText = `@${entryLabel(entry)}`;
  return {
    type: 'tag',
    key: `workspace:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    props: {
      label: (
        <span className="chat-workspace-mention-slot" title={entry.path}>
          {displayText}
        </span>
      ),
      value: resultText,
    },
    formatResult: () => resultText,
  };
}

function entryDisplayName(entry: WorkspaceEntrySearchItem): string {
  const fallback = entry.path.split('/').filter(Boolean).pop() || entry.path;
  const name = (entry.name || fallback).trim() || fallback;
  return entry.kind === 'directory' ? `${name.replace(/\/$/, '')}/` : name;
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

function createTextSlot(value: string): SlotConfigType {
  return { type: 'text', value };
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
  return range.toString().length;
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

const maxImageAttachments = 8;
const maxImageSize = 8 * 1024 * 1024;

function readImageAttachment(file: File): Promise<RuntimeMessageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (!url) {
        reject(new Error('图片读取失败'));
        return;
      }
      resolve({
        id: `image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || 'image',
        type: file.type || 'image/png',
        size: file.size,
        url,
      });
    };
    reader.readAsDataURL(file);
  });
}
