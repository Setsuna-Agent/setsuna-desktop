import {
  isRuntimeInputMessageAttachment,
  parsePluginMentions,
  type MessagePatch,
  type RuntimeMessage,
  type RuntimePluginSummary,
  type RuntimeSkillSummary,
  type WorkspaceEntrySearchResponse,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import type { ChatAttachmentClient } from '../../composer/chatAttachmentStore.js';
import { useChatAttachments } from '../../composer/useChatAttachments.js';
import { useChatCommandController } from '../../composer/useChatCommandController.js';
import { useChatComposerClipboard } from '../../composer/useChatComposerClipboard.js';
import { createChatCapabilityCommandItems, createChatSkillCommandItems } from '../../composer/chatSlashCommandItems.js';
import type { SlashCommandMenuItem } from '../../composer/ChatSlashCommandMenu.js';
import { parseMentionCommand, parseSkillCommand, parseSlashCommand } from '../../composer/chatCommandUtils.js';
import {
  createBrowserTabMentionSlot,
  createMessageDraftSlots,
  createPluginAppMentionSlot,
  createSelectedPluginSlot,
  createSelectedSkillReferences,
  createSelectedSkillSlot,
  createTextSlot,
  createWorkspaceMentionSlots,
  filterSelectedSkillsBySlots,
} from '../../composer/chatComposerSlots.js';
import type { ComposerEditor, ComposerSlot } from '../../composer/editor/types.js';
import type { ChatMentionItem } from '../../mentions/chatMentionItems.js';

export type UserMessageEditorStateProps = {
  message: RuntimeMessage;
  disabled: boolean;
  submitting: boolean;
  onCancel(): void;
  onSubmit(input: MessagePatch): Promise<boolean>;
};

export type UserMessageEditorProps = UserMessageEditorStateProps & {
  client: ChatAttachmentClient;
  activeProject?: WorkspaceProject;
  skills: RuntimeSkillSummary[];
  plugins: RuntimePluginSummary[];
  onSearchProjectEntries(query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
};

/** The inline editor owns its unsent draft/uploads; the transcript owns the mutation request. */
export function useUserMessageEditor({
  message,
  client,
  activeProject,
  disabled,
  submitting,
  skills,
  plugins,
  onSearchProjectEntries,
  onSubmit,
}: UserMessageEditorProps) {
  const { t } = useI18n();
  const editorRef = useRef<ComposerEditor>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [initialMessage] = useState(message);
  const [initialSlots] = useState(() => {
    const restored = createMessageDraftSlots(message, skills, plugins);
    // Sent text is trimmed. Restore the separator after a final tag so typing @, / or $
    // immediately after opening the editor behaves like a freshly selected reference.
    return restored.at(-1)?.type === 'tag' ? [...restored, createTextSlot(' ')] : restored;
  });
  const [draft, setDraft] = useState(message.content);
  const [slots, setSlots] = useState(initialSlots);
  const attachments = useChatAttachments({ client });
  const locked = disabled || submitting || attachments.sending;
  const { replaceWithExisting } = attachments;
  useEffect(() => {
    replaceWithExisting((initialMessage.attachments ?? []).filter(isRuntimeInputMessageAttachment));
    editorRef.current?.focus({ cursor: 'end', preventScroll: true });
  }, [initialMessage, replaceWithExisting]);

  const getEditor = useCallback(() => editorRef.current, []);
  const getInputElement = useCallback(() => editorRef.current?.inputElement ?? null, []);
  const commands = useChatCommandController({ activeProject, draft, plugins, getInputElement, onSearchProjectEntries, slashMenuBlocked: locked, t });
  const selectedSkills = useMemo(() => filterSelectedSkillsBySlots(skills, slots), [skills, slots]);
  const slashEntries = useMemo(() => {
    const query = commands.slashQuery;
    if (commands.skillCommand) return createChatSkillCommandItems({ query, skills, selectedSkills });
    const upload: SlashCommandMenuItem = {
      key: 'attachment', kind: 'action', type: 'attachment', title: t('chat.composer.uploadAttachment'),
      description: t('chat.composer.uploadAttachmentHint'), disabled: locked || attachments.atLimit,
    };
    return [
      ...(!query || `${upload.key} ${upload.title} ${upload.description}`.toLowerCase().includes(query) ? [upload] : []),
      ...createChatCapabilityCommandItems({ query, plugins, skills, selectedSkills,
        selectedPluginIds: parsePluginMentions(draft).map((mention) => mention.pluginId) }),
    ];
  }, [attachments.atLimit, commands.skillCommand, commands.slashQuery, draft, locked, plugins, selectedSkills, skills, t]);

  const addFiles = (files: File[]) => {
    if (!locked) void attachments.addFiles(files);
  };
  const clipboard = useChatComposerClipboard({
    disabled: locked, getEditor, skills, plugins,
    // ChatPromptInput's change event already reconciles every pasted reference.
    onSkillsRestored: () => undefined,
    onPasteTextAttachment: (file) => {
      if (locked || attachments.atLimit) return false;
      addFiles([file]);
      return true;
    },
  });
  const onChange = (value: string, _event?: unknown, nextSlots: ComposerSlot[] = []) => {
    commands.handleDraftValueChange(value);
    setDraft(value);
    setSlots(nextSlots);
  };
  const selectMention = (item?: ChatMentionItem) => {
    const command = commands.mentionCommand ?? parseMentionCommand(draft, commands.commandCursorOffset);
    if (locked || !command || !item) return;
    const nextSlots = item.kind === 'app' ? [createPluginAppMentionSlot(item.app), createTextSlot(' ')]
      : item.kind === 'browser-tab' ? [createBrowserTabMentionSlot(item.tab), createTextSlot(' ')]
        : createWorkspaceMentionSlots(item.entry);
    editorRef.current?.insert(nextSlots, 'cursor', draft.slice(command.start, command.end), true);
    commands.acceptMentionSelection();
  };
  const selectSlash = (item?: SlashCommandMenuItem) => {
    if (locked || !item || (item.kind === 'action' && item.disabled)) return;
    const command = commands.skillCommand ?? commands.slashCommand
      ?? parseSkillCommand(draft, commands.commandCursorOffset) ?? parseSlashCommand(draft, commands.commandCursorOffset);
    if (!command && !commands.forcedSlashMenuOpen) return;
    const nextSlots = item.kind === 'skill' ? [createSelectedSkillSlot(item.skill), createTextSlot(' ')]
      : item.kind === 'plugin' ? [createSelectedPluginSlot(item.plugin), createTextSlot(' ')] : [createTextSlot('')];
    editorRef.current?.insert(nextSlots, 'cursor', command ? draft.slice(command.start, command.end) : undefined, true);
    commands.acceptSlashSelection();
    if (item.kind === 'action' && item.type === 'attachment') fileInputRef.current?.click();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (commands.slashMenuOpen) return commands.handleSlashKeyDown(event, slashEntries, selectSlash);
    if (commands.mentionMenuOpen) return commands.handleMentionKeyDown(event, selectMention);
  };
  const submit = async () => {
    if (locked || attachments.busy || attachments.getSnapshot().sending) return;
    const current = editorRef.current?.getValue();
    const content = (current?.value ?? draft).trim();
    const submittedAttachments = attachments.sendableAttachments.filter(isRuntimeInputMessageAttachment);
    if (!content && !submittedAttachments.length) return;
    const skillReferences = createSelectedSkillReferences(current?.slotConfig ?? slots);
    const originalReferenceIds = new Set(createSelectedSkillReferences(initialSlots).map((reference) => reference.skillId));
    // Older messages may select Skills without visible ranges; editing text must retain those selections.
    const unreferencedSkillIds = (initialMessage.skillIds ?? []).filter((id) => !originalReferenceIds.has(id));
    // Protect pending uploads if navigation unmounts the editor during regeneration.
    attachments.beginSend(submittedAttachments);
    const sent = await onSubmit({
      content,
      attachments: submittedAttachments,
      skillReferences,
      skillIds: [...new Set([...unreferencedSkillIds, ...skillReferences.map((reference) => reference.skillId)])],
    }).catch(() => false);
    attachments.settleSend(submittedAttachments, sent);
  };
  return { editorRef, fileInputRef, draft, initialSlots, attachments, locked, commands, slashEntries, clipboard, addFiles, onChange, selectMention, selectSlash, onKeyDown, submit };
}
