import {
  detectWorkspacePreviewImageMimeType as detectWorkspacePreviewImageMimeTypeFromContent,
  isProbablyBinaryFileContent,
  type WorkspaceFilePreviewImageMimeType,
} from '@setsuna-desktop/contracts';

/** Detect browser-previewable images by content instead of trusting a spoofable extension. */
export function detectWorkspacePreviewImageMimeType(buffer: Buffer): WorkspaceFilePreviewImageMimeType | null {
  return detectWorkspacePreviewImageMimeTypeFromContent(buffer);
}

/** Keep arbitrary binary payloads out of the UTF-8 code preview. */
export function isProbablyBinaryWorkspaceFile(buffer: Buffer): boolean {
  return isProbablyBinaryFileContent(buffer);
}
