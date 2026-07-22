import {
  PUBLISH_ARTIFACT_TOOL_NAME,
  type DesktopOpenPathResult,
  type DesktopWorkspaceFilePreviewResult,
  type RuntimeArtifact,
  type RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

type WorkspaceArtifactOpener = (workspaceRoot: string, filePath: string) => Promise<DesktopOpenPathResult>;
type WorkspaceArtifactPreviewCreator = (
  workspaceRoot: string,
  filePath: string,
) => Promise<DesktopWorkspaceFilePreviewResult>;

const documentExtensions = new Set(['doc', 'docx', 'md', 'odt', 'pdf', 'rtf', 'txt']);
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx']);
const presentationExtensions = new Set(['key', 'ppt', 'pptx']);
const imageExtensions = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);
const archiveExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const videoExtensions = new Set(['avi', 'mkv', 'mov', 'mp4', 'webm']);
const dataExtensions = new Set(['json', 'xml', 'yaml', 'yml']);

export function runtimeArtifactsFromToolRuns(runs: readonly RuntimeToolRun[]): RuntimeArtifact[] {
  const artifactsByLocation = new Map<string, RuntimeArtifact>();
  for (const run of runs) {
    if (run.name !== PUBLISH_ARTIFACT_TOOL_NAME || run.status !== 'success') continue;
    const artifact = runtimeArtifactFromData(run.data);
    if (!artifact) continue;
    const location = `${artifact.workspaceRoot}\u0000${artifact.path}`;
    // 重新发布的文件保留最新元数据及其在列表中的最新位置。
    artifactsByLocation.delete(location);
    artifactsByLocation.set(location, artifact);
  }
  return [...artifactsByLocation.values()];
}

export function runtimeArtifactTypeLabel(
  artifact: RuntimeArtifact,
  t: Translate = defaultTranslate,
): string {
  const extension = fileExtension(artifact.name || artifact.path);
  if (!extension) return t('chat.artifact.type.file');
  const format = extension === 'jpeg' ? 'JPG' : extension.toUpperCase();
  if (documentExtensions.has(extension)) return t('chat.artifact.type.document', { format });
  if (spreadsheetExtensions.has(extension)) return t('chat.artifact.type.spreadsheet', { format });
  if (presentationExtensions.has(extension)) return t('chat.artifact.type.presentation', { format });
  if (imageExtensions.has(extension)) return t('chat.artifact.type.image', { format });
  if (archiveExtensions.has(extension)) return t('chat.artifact.type.archive', { format });
  if (audioExtensions.has(extension)) return t('chat.artifact.type.audio', { format });
  if (videoExtensions.has(extension)) return t('chat.artifact.type.video', { format });
  if (dataExtensions.has(extension)) return t('chat.artifact.type.data', { format });
  if (extension === 'html' || extension === 'htm') return t('chat.artifact.type.webpage', { format });
  return t('chat.artifact.type.generic', { format });
}

export async function openRuntimeArtifactWithDefaultApp(
  artifact: RuntimeArtifact,
  openWorkspaceFile: WorkspaceArtifactOpener,
  t: Translate = defaultTranslate,
): Promise<string | null> {
  const result = await openWorkspaceFile(artifact.workspaceRoot, artifact.path);
  return result.ok ? null : result.error ?? t('chat.artifact.openFailed');
}

export function runtimeArtifactSupportsBrowserPreview(artifact: RuntimeArtifact): boolean {
  const mimeType = artifact.mimeType.trim().toLowerCase();
  const extension = fileExtension(artifact.name || artifact.path);
  return mimeType === 'application/pdf'
    || mimeType.startsWith('image/')
    || extension === 'pdf'
    || imageExtensions.has(extension);
}

export async function openRuntimeArtifactInBrowser(
  artifact: RuntimeArtifact,
  createPreview: WorkspaceArtifactPreviewCreator,
  openBrowser: (url: string) => void,
): Promise<string | null> {
  const result = await createPreview(artifact.workspaceRoot, artifact.path);
  if (!result.ok) return result.error;
  openBrowser(result.url);
  return null;
}

function runtimeArtifactFromData(data: unknown): RuntimeArtifact | null {
  if (!isRecord(data) || !isRecord(data.artifact)) return null;
  const artifact = data.artifact;
  if (artifact.kind !== 'file') return null;
  if (!nonEmptyString(artifact.id)
    || !nonEmptyString(artifact.name)
    || !nonEmptyString(artifact.projectId)
    || !nonEmptyString(artifact.workspaceRoot)
    || !nonEmptyString(artifact.path)
    || !nonEmptyString(artifact.mimeType)
    || typeof artifact.size !== 'number'
    || !Number.isFinite(artifact.size)
    || artifact.size < 0
    || (artifact.modifiedAt !== undefined && typeof artifact.modifiedAt !== 'string')) return null;
  if (!isAbsolutePath(artifact.workspaceRoot) || !isSafeRelativePath(artifact.path)) return null;
  return {
    id: artifact.id,
    kind: 'file',
    name: artifact.name,
    projectId: artifact.projectId,
    workspaceRoot: artifact.workspaceRoot,
    path: artifact.path,
    mimeType: artifact.mimeType,
    size: artifact.size,
    modifiedAt: artifact.modifiedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/u.test(value);
}

function isSafeRelativePath(value: string): boolean {
  if (isAbsolutePath(value)) return false;
  return !value.replace(/\\/gu, '/').split('/').includes('..');
}

function fileExtension(value: string): string {
  const fileName = value.split(/[\\/]/u).at(-1) ?? value;
  const extensionStart = fileName.lastIndexOf('.');
  return extensionStart > 0 && extensionStart < fileName.length - 1
    ? fileName.slice(extensionStart + 1).toLowerCase()
    : '';
}
