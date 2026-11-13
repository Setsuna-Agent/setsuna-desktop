import type { DesktopConversationExportInput } from '@setsuna-desktop/contracts';

export function isExportInput(value: unknown): value is DesktopConversationExportInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<DesktopConversationExportInput>;
  return typeof input.title === 'string' && typeof input.content === 'string'
    && (input.format === 'markdown' || input.format === 'html' || input.format === 'png');
}

export async function exportBytes(input: DesktopConversationExportInput): Promise<Buffer> {
  return input.format === 'png'
    ? (await import('./render-conversation-image.js')).renderConversationImage(input.content)
    : Buffer.from(input.content, 'utf8');
}

export function exportFilename(title: string, extension: string): string {
  let name = title.normalize('NFKC').replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim()
    .slice(0, 100).replace(/[. ]+$/gu, '') || 'conversation';
  // Windows device names remain reserved even when followed by an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = `_${name}`;
  return `${name}.${extension}`;
}
