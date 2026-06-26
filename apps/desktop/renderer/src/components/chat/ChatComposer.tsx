import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Sender } from '@ant-design/x';
import { Progress, Tooltip } from 'antd';
import { ArrowUp, ImagePlus, Paperclip, Square, X } from 'lucide-react';
import type { RuntimeConfigState, RuntimeMessageAttachment, RuntimeSkillSummary, WorkspaceEntrySearchItem, WorkspaceProject } from '@setsuna-desktop/contracts';
import { ChatApprovalPolicyMenu, ChatPermissionProfileMenu } from './ChatApprovalPolicyMenu.js';
import { ProjectEntryCommandMenu, SelectedSkillChips } from './ChatCommandMenus.js';
import { ChatModelPicker } from './ChatModelPicker.js';
import { ChatSlashCommandMenu, type SlashCommandMenuItem } from './ChatSlashCommandMenu.js';
import { formatTokenCount, type ChatContextTokenUsage } from './chatContextUsage.js';
import { entryLabel, parseMentionCommand, parseSlashCommand, skillTokenText, stripSkillToken } from './chatCommandUtils.js';

type SlashQuickAction = Exclude<SlashCommandMenuItem, { kind: 'skill' }>;

export function ChatComposer({
  activeTurnId,
  activeProject,
  config,
  canClearContext,
  contextCompacting = false,
  contextUsage,
  draft,
  skills,
  starter = false,
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onCompactContext,
  onClearContext,
  onDraftChange,
  onPermissionProfileChange,
  onSelectModel,
  onSearchProjectEntries,
  onSend,
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  config: RuntimeConfigState | null;
  canClearContext: boolean;
  contextCompacting?: boolean;
  contextUsage: ChatContextTokenUsage;
  draft: string;
  skills: RuntimeSkillSummary[];
  starter?: boolean;
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDraftChange: (value: string) => void;
  onPermissionProfileChange: (profile: RuntimeConfigState['permissionProfile']) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchItem[]>;
  onSend: (value?: string, options?: { attachments?: RuntimeMessageAttachment[]; skillIds?: string[] }) => void;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mentionCommand = useMemo(() => parseMentionCommand(draft), [draft]);
  const slashCommand = useMemo(() => parseSlashCommand(draft), [draft]);
  const mentionQuery = mentionCommand?.query ?? '';
  const commandOpen = Boolean(activeProject && focused && mentionCommand && dismissedCommandValue !== draft);
  const skillCommandOpen = Boolean(focused && slashCommand && dismissedSlashValue !== draft && !commandOpen);
  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map((skill) => skill.id)), [selectedSkills]);
  const skillQuery = slashCommand?.query.trim().toLowerCase() ?? '';
  const supportsImageInput = activeModelSupportsImages(config);
  const attachmentOnlyReady = imageAttachments.length > 0 && !draft.trim();
  const contextCompactPercent = Math.round(Number(contextUsage.percent || 0));
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
  }, [canClearContext, config, contextCompactPercent, contextCompacting, selectedSkillIds, skillQuery, skills]);

  useEffect(() => {
    if (!commandOpen) {
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
    setActiveSkillIndex(0);
  }, [skillQuery]);

  useEffect(() => {
    if (!supportsImageInput && imageAttachments.length) setImageAttachments([]);
  }, [imageAttachments.length, supportsImageInput]);

  const selectEntry = (entry?: WorkspaceEntrySearchItem) => {
    const command = parseMentionCommand(draft);
    if (!command || !entry) return;
    const nextDraft = `${draft.slice(0, command.start)}@${entryLabel(entry)} ${draft.slice(command.end)}`;
    setDismissedCommandValue('');
    onDraftChange(nextDraft);
  };

  const selectSkill = (skill?: RuntimeSkillSummary) => {
    const command = parseSlashCommand(draft);
    if (!command || !skill) return;
    const tokenText = skillTokenText(skill);
    const nextDraft = `${draft.slice(0, command.start)}${tokenText} ${draft.slice(command.end)}`;
    setDismissedSlashValue('');
    setSelectedSkills((current) => (current.some((item) => item.id === skill.id) ? current : [...current, skill]));
    onDraftChange(nextDraft);
  };

  const handleChange = (value: string) => {
    if (dismissedCommandValue && dismissedCommandValue !== value) setDismissedCommandValue('');
    if (dismissedSlashValue && dismissedSlashValue !== value) setDismissedSlashValue('');
    onDraftChange(value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (skillCommandOpen) return handleSkillKeyDown(event);
    if (!commandOpen) return undefined;
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
    return undefined;
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

  const removeSelectedSkill = (skill: RuntimeSkillSummary) => {
    setSelectedSkills((current) => current.filter((item) => item.id !== skill.id));
    onDraftChange(stripSkillToken(draft, skill));
  };

  const selectSlashEntry = (item?: SlashCommandMenuItem) => {
    if (!item) return;
    if (item.kind === 'skill') {
      selectSkill(item.skill);
      return;
    }
    const command = parseSlashCommand(draft);
    const nextDraft = command ? `${draft.slice(0, command.start)}${draft.slice(command.end)}`.trimStart() : draft;
    setDismissedSlashValue('');
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
    onSend(value, {
      attachments: supportsImageInput ? imageAttachments : [],
      skillIds: selectedSkills.map((skill) => skill.id),
    });
    setSelectedSkills([]);
    setImageAttachments([]);
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

  const insertProjectMentionCommand = () => {
    if (!activeProject) return;
    const trimmed = draft.trimEnd();
    onDraftChange(`${trimmed}${trimmed ? ' ' : ''}@`);
    setDismissedCommandValue('');
    setFocused(true);
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
      {selectedSkills.length ? <SelectedSkillChips skills={selectedSkills} onRemove={removeSelectedSkill} /> : null}
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
        value={draft}
        loading={Boolean(activeTurnId)}
        placeholder="输入消息（输入 / 唤起命令）"
        autoSize={{ minRows: 2, maxRows: 6 }}
        suffix={false}
        onBlur={() => setFocused(false)}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
        onPasteFile={(files) => {
          void addImageFiles(Array.from(files));
        }}
        onSubmit={submitDraft}
        onCancel={onCancelActiveTurn}
        footer={(actions) => (
          <div className="chat-sender__footer">
            <div className="chat-sender__left-actions">
              <ChatApprovalPolicyMenu
                disabled={Boolean(activeTurnId)}
                policy={config?.approvalPolicy ?? 'on-request'}
                onChange={onApprovalPolicyChange}
              />
              <ChatPermissionProfileMenu
                disabled={Boolean(activeTurnId)}
                profile={config?.permissionProfile ?? 'workspace-write'}
                onChange={onPermissionProfileChange}
              />
              <ContextUsageIndicator contextCompacting={contextCompacting} usage={contextUsage} />
            </div>
            <div className="chat-sender__right-actions">
              <button
                className="chat-sender-icon-button"
                type="button"
                aria-label="上传图片"
                title={supportsImageInput ? '上传图片' : '当前模型未启用图片输入'}
                disabled={Boolean(activeTurnId) || !supportsImageInput || imageAttachments.length >= maxImageAttachments}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={13} />
              </button>
              <button
                className="chat-sender-icon-button"
                type="button"
                aria-label="添加项目文件"
                disabled={!activeProject}
                onClick={insertProjectMentionCommand}
              >
                <Paperclip size={13} />
              </button>
              <span className="chat-sender-divider" aria-hidden="true" />
              <ChatModelPicker config={config} disabled={Boolean(activeTurnId)} openSignal={modelOpenSignal} onSelect={onSelectModel} />
              <span className="chat-sender-divider" aria-hidden="true" />
              {activeTurnId ? (
                <button className="chat-sender-stop" type="button" aria-label="停止生成" onClick={onCancelActiveTurn}>
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

function ContextUsageIndicator({
  contextCompacting,
  usage,
}: {
  contextCompacting: boolean;
  usage: ChatContextTokenUsage;
}) {
  if (usage.usedTokens <= 0) return null;
  const percentValue = Math.min(100, Math.max(0, Number(usage.visiblePercent || usage.percent || 0)));
  const percentLabel = percentValue > 0 ? `${percentValue.toFixed(percentValue > 0 && percentValue < 1 ? 1 : 0)}%` : '已用';
  const scopeLabels = usage.triggerScopes.map(formatContextScope).filter(Boolean);
  const tooltipLines = [
    `当前上下文 ${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.totalTokens)} tokens（${percentLabel}）`,
    usage.compactedMessageCount > 0 ? `已覆盖 ${usage.compactedMessageCount} 条历史消息` : '',
    scopeLabels.length ? `触发 ${scopeLabels.join(' / ')}` : '',
    usage.summaryRole ? `摘要角色 ${usage.summaryRole}` : '',
  ].filter(Boolean);

  return (
    <Tooltip
      title={(
        <div className="chat-context-token-tooltip">
          {tooltipLines.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      placement="top"
    >
      <button className="chat-context-token-chip" type="button" aria-label={`当前上下文用量 ${percentLabel}`}>
        <Progress
          className="chat-token-progress"
          type="circle"
          percent={percentValue}
          size={14}
          strokeWidth={18}
          showInfo={false}
          status={contextCompacting ? 'active' : 'normal'}
        />
        <span>{contextCompacting ? '压缩中' : percentLabel}</span>
      </button>
    </Tooltip>
  );
}

function formatContextScope(scope: string): string {
  if (scope === 'manual') return '手动';
  if (scope === 'body_after_prefix') return '正文';
  if (scope === 'total') return '总量';
  return scope;
}

function activeModelName(config: RuntimeConfigState | null): string | null {
  const provider = config?.providers.find((item) => item.id === config.activeProviderId) ?? config?.providers[0];
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  return model?.name ?? null;
}

function activeModelSupportsImages(config: RuntimeConfigState | null): boolean {
  const provider = config?.providers.find((item) => item.id === config.activeProviderId) ?? config?.providers[0];
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  return Boolean(model?.supportsImages);
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
