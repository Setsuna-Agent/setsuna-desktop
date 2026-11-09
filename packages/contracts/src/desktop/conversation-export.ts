export type DesktopConversationExportFormat = 'markdown' | 'html';

export type DesktopConversationExportInput = {
  title: string;
  format: DesktopConversationExportFormat;
  content: string;
};

export type DesktopConversationExportResult =
  | { ok: true; cancelled?: boolean }
  | { ok: false; error: string };
