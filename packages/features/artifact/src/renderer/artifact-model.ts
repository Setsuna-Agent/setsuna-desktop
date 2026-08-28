import type { RuntimeArtifact } from '../contracts/index.js';

type ArtifactTranslate = (key: `feature.${string}`, params?: Record<string, string | number>) => string;

const documentExtensions = new Set(['doc', 'docx', 'md', 'odt', 'pdf', 'rtf', 'txt']);
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx']);
const presentationExtensions = new Set(['key', 'ppt', 'pptx']);
const imageExtensions = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp']);
const archiveExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const videoExtensions = new Set(['avi', 'mkv', 'mov', 'mp4', 'webm']);
const dataExtensions = new Set(['json', 'xml', 'yaml', 'yml']);

export function artifactTypeLabel(artifact: RuntimeArtifact, translate: ArtifactTranslate): string {
  const extension = fileExtension(artifact.name || artifact.path);
  if (!extension) return translate('feature.artifact.type.file');
  const format = extension === 'jpeg' ? 'JPG' : extension.toUpperCase();
  if (documentExtensions.has(extension)) return translate('feature.artifact.type.document', { format });
  if (spreadsheetExtensions.has(extension)) return translate('feature.artifact.type.spreadsheet', { format });
  if (presentationExtensions.has(extension)) return translate('feature.artifact.type.presentation', { format });
  if (imageExtensions.has(extension)) return translate('feature.artifact.type.image', { format });
  if (archiveExtensions.has(extension)) return translate('feature.artifact.type.archive', { format });
  if (audioExtensions.has(extension)) return translate('feature.artifact.type.audio', { format });
  if (videoExtensions.has(extension)) return translate('feature.artifact.type.video', { format });
  if (dataExtensions.has(extension)) return translate('feature.artifact.type.data', { format });
  if (extension === 'html' || extension === 'htm') return translate('feature.artifact.type.webpage', { format });
  return translate('feature.artifact.type.generic', { format });
}

function fileExtension(value: string): string {
  const fileName = value.split(/[\\/]/u).at(-1) ?? value;
  const extensionStart = fileName.lastIndexOf('.');
  return extensionStart > 0 && extensionStart < fileName.length - 1
    ? fileName.slice(extensionStart + 1).toLowerCase()
    : '';
}
