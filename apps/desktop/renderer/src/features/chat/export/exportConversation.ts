import type { DesktopConversationExportFile, DesktopConversationExportFormat, DesktopConversationExportInput, DesktopConversationExportResult, DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import type { AppLocale, Translate } from '../../../shared/i18n/I18nProvider.js';
import { conversationExportContent, conversationExportMarkdown } from './conversationExportContent.js';

export type ConversationExportPreview = {
  file: DesktopConversationExportFile;
  input: DesktopConversationExportInput;
  markdown: string;
};

export async function exportConversation(
  client: Pick<DesktopRuntimeClient, 'getThread'>,
  threadId: string,
  format: DesktopConversationExportFormat,
  t: Translate,
  locale: AppLocale,
  selectedMessageIds?: readonly string[],
): Promise<Extract<DesktopConversationExportResult, { ok: true }>> {
  const desktop = window.setsunaDesktop?.desktop;
  if (!desktop?.saveConversationExport) throw new Error(t('chat.export.unavailable'));
  const { input } = await createExportInput(client, threadId, format, t, locale, selectedMessageIds);
  const result = await desktop.saveConversationExport(input);
  if (!result.ok) throw new Error(result.error);
  return result;
}

export async function prepareConversationExport(
  client: Pick<DesktopRuntimeClient, 'getThread'>,
  threadId: string,
  format: DesktopConversationExportFormat,
  t: Translate,
  locale: AppLocale,
  selectedMessageIds?: readonly string[],
): Promise<ConversationExportPreview> {
  const desktop = window.setsunaDesktop?.desktop;
  if (!desktop?.prepareConversationExport) throw new Error(t('chat.export.unavailable'));
  const source = await createExportInput(client, threadId, format, t, locale, selectedMessageIds);
  const result = await desktop.prepareConversationExport(source.input);
  if (!result.ok) throw new Error(result.error);
  return { ...source, file: result.file };
}

async function createExportInput(
  client: Pick<DesktopRuntimeClient, 'getThread'>,
  threadId: string,
  format: DesktopConversationExportFormat,
  t: Translate,
  locale: AppLocale,
  selectedMessageIds?: readonly string[],
): Promise<{ input: DesktopConversationExportInput; markdown: string }> {
  // One persisted snapshot keeps long histories complete and avoids pagination races.
  const thread = await client.getThread(threadId, { fullHistory: true });
  const document = conversationExportContent(thread, t, locale, selectedMessageIds ? new Set(selectedMessageIds) : undefined);
  if (selectedMessageIds && !document.entries.length) throw new Error(t('chat.export.empty'));
  const markdown = conversationExportMarkdown(document);
  let content = markdown;
  if (format !== 'markdown') {
    const { conversationExportHtml } = await import('./conversationExportHtml.js');
    content = await conversationExportHtml(document, locale, format);
  }
  return { input: { title: document.title, format, content }, markdown };
}
