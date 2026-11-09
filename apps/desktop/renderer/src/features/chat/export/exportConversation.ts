import type { DesktopConversationExportFormat, DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import type { AppLocale, Translate } from '../../../shared/i18n/I18nProvider.js';
import { conversationExportContent, conversationExportMarkdown } from './conversationExportContent.js';

export async function exportConversation(
  client: Pick<DesktopRuntimeClient, 'getThread'>,
  threadId: string,
  format: DesktopConversationExportFormat,
  t: Translate,
  locale: AppLocale,
): Promise<void> {
  const desktop = window.setsunaDesktop?.desktop;
  if (!desktop?.saveConversationExport) throw new Error(t('chat.export.unavailable'));
  // One persisted snapshot keeps long histories complete and avoids pagination races.
  const thread = await client.getThread(threadId, { fullHistory: true });
  const document = conversationExportContent(thread, t, locale);
  let content: string;
  if (format === 'html') {
    const { conversationExportHtml } = await import('./conversationExportHtml.js');
    content = await conversationExportHtml(document, locale);
  } else {
    content = conversationExportMarkdown(document);
  }
  const result = await desktop.saveConversationExport({ title: document.title, format, content });
  if (!result.ok) throw new Error(result.error);
}
