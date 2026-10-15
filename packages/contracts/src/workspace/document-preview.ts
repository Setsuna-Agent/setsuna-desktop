import { isProbablyBinaryFileContent, type DocumentPreviewFormat } from '../workspace.js';

/** Bounds each IPC payload before a document parser allocates its own working memory. */
export const DOCUMENT_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

export type DocumentPreviewReadResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; error: string };

export function getDocumentPreviewFormat(filePath: string): DocumentPreviewFormat | null {
  const extension = /\.([^./\\]+)$/u.exec(filePath)?.[1].toLowerCase();
  return extension === 'docx' || extension === 'pptx' || extension === 'xlsx' || extension === 'csv' || extension === 'pdf'
    ? extension : null;
}

/** Only sniff the container here; the format's viewer validates the complete document. */
export function isDocumentPreviewContent(format: DocumentPreviewFormat, data: Uint8Array): boolean {
  if (format === 'pdf') return data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 && data[4] === 0x2d;
  return format === 'csv' ? !isProbablyBinaryFileContent(data)
    : data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}
