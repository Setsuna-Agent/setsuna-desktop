export type DesktopConversationExportFormat = 'markdown' | 'html' | 'png';

export type DesktopConversationExportInput = {
  title: string;
  format: DesktopConversationExportFormat;
  /** Markdown text, or inert HTML for HTML/PNG exports. Main renders PNG on demand. */
  content: string;
};

export type DesktopConversationExportResult =
  | { ok: true; cancelled?: boolean; file?: { name: string; path: string } }
  | { ok: false; error: string };

export type DesktopConversationExportFile = {
  id: string;
  name: string;
  path: string;
  format: DesktopConversationExportFormat;
  imageDataUrl?: string;
};

export type DesktopConversationExportPreviewResult =
  | { ok: true; file: DesktopConversationExportFile }
  | { ok: false; error: string };
