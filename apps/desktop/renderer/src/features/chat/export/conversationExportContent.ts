import type { RuntimeMessage, RuntimeMessageAttachment, RuntimeThread } from '@setsuna-desktop/contracts';
import type { AppLocale, Translate } from '../../../shared/i18n/I18nProvider.js';
import { assistantRunCopyText, buildChatTranscript } from '../conversation/chatMessageDisplay.js';
import { visibleMarkdownContent } from '../conversation/chatThinkingContent.js';

export type ConversationExportEntry = { role: 'user' | 'assistant'; heading: string; content: string };
export type ConversationExportDocument = { title: string; entries: ConversationExportEntry[] };

/** Export the visible transcript, never the runtime snapshot or provider metadata. */
export function conversationExportContent(thread: RuntimeThread, t: Translate, locale: AppLocale, selectedMessageIds?: ReadonlySet<string>): ConversationExportDocument {
  const entries: ConversationExportEntry[] = [];
  const exportedUserIds = new Set<string>();
  const userEntry = (message: RuntimeMessage): ConversationExportEntry => ({
    role: 'user',
    heading: t('chat.navigation.user'),
    content: [message.content.trim(), attachmentMarkdown(message.attachments ?? [])].filter(Boolean).join('\n\n'),
  });
  const appendUser = (message: RuntimeMessage) => {
    if (selectedMessageIds && !selectedMessageIds.has(message.id)) return;
    if (exportedUserIds.has(message.id)) return;
    exportedUserIds.add(message.id);
    entries.push(userEntry(message));
  };
  for (const item of buildChatTranscript(thread.messages)) {
    if (item.type === 'user') {
      appendUser(item.message);
      item.steerMessages.forEach(appendUser);
    } else if (item.type === 'assistant') {
      item.steerMessages.forEach(appendUser);
      // Resolve the selection after grouping the full snapshot: a loaded page may
      // contain only the end of a reply, and omitted questions must not merge replies.
      if (selectedMessageIds && !item.segments.some((segment) => selectedMessageIds.has(segment.id))) continue;
      // Keep final answers, including legacy messages without a phase; omit execution feedback.
      const segments = item.segments.filter((segment) => segment.phase !== 'commentary').map((segment) => ({
        ...segment, phase: segment.phase ?? 'final_answer', toolRuns: undefined, error: undefined,
      }));
      const attachments = [...segments.flatMap((segment) => segment.attachments ?? []), ...(item.toolAttachments ?? [])];
      const uniqueAttachments = [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()];
      const content = [assistantRunCopyText({ ...item, segments, goalExit: undefined }, t, locale), attachmentMarkdown(uniqueAttachments)]
        .filter(Boolean).join('\n\n');
      if (content) entries.push({ role: 'assistant', heading: t('chat.navigation.assistant'), content });
    } else if (item.type === 'review' && item.message.reviewMode?.kind === 'exited') {
      if (selectedMessageIds && !selectedMessageIds.has(item.message.id)) continue;
      const review = item.message.reviewMode;
      entries.push({ role: 'assistant', heading: t('chat.navigation.assistant'), content: review.reasoningSeparated ? review.review : visibleMarkdownContent(review.review) });
    }
  }
  return { title: thread.title.trim() || t('settings.archives.untitled'), entries };
}

export function conversationExportMarkdown(document: ConversationExportDocument): string {
  return [`# ${escapeMarkdownText(document.title)}`, ...document.entries.map((entry) => [
    `## ${escapeMarkdownText(entry.heading)}`, entry.content,
  ].filter(Boolean).join('\n\n'))].join('\n\n---\n\n') + '\n';
}

function attachmentMarkdown(attachments: RuntimeMessageAttachment[]): string {
  return attachments.map((attachment) => {
    const name = escapeMarkdownText(attachment.name);
    if (attachment.source === 'runtime' || attachment.source === 'generated') return `- ${name}`;
    const url = attachment.url;
    const image = /^image\//iu.test(attachment.type);
    if (!/^https?:\/\//iu.test(url) && !(image && /^data:image\/(png|jpeg|gif|webp);base64,/iu.test(url))) return `- ${name}`;
    const target = url.replace(/[<>\s]/gu, (character) => encodeURIComponent(character));
    return `${image ? '!' : ''}[${name}](<${target}>)`;
  }).join('\n\n');
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\s+/gu, ' ').replace(/[\\`*{}[\]()#+.!<>|_-]/gu, '\\$&');
}
