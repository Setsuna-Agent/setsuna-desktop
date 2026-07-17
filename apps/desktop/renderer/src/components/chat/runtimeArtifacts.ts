import {
  PUBLISH_ARTIFACT_TOOL_NAME,
  type DesktopOpenPathResult,
  type RuntimeArtifact,
  type RuntimeToolRun,
} from '@setsuna-desktop/contracts';

type WorkspaceArtifactOpener = (workspaceRoot: string, filePath: string) => Promise<DesktopOpenPathResult>;

const documentExtensions = new Set(['doc', 'docx', 'md', 'odt', 'pdf', 'rtf', 'txt']);
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx']);
const presentationExtensions = new Set(['key', 'ppt', 'pptx']);
const imageExtensions = new Set(['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
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
    // Republished files keep their latest metadata and their latest position in the list.
    artifactsByLocation.delete(location);
    artifactsByLocation.set(location, artifact);
  }
  return [...artifactsByLocation.values()];
}

export function runtimeArtifactTypeLabel(artifact: RuntimeArtifact): string {
  const extension = fileExtension(artifact.name || artifact.path);
  if (!extension) return '文件';
  const format = extension === 'jpeg' ? 'JPG' : extension.toUpperCase();
  if (documentExtensions.has(extension)) return `文档 · ${format}`;
  if (spreadsheetExtensions.has(extension)) return `表格 · ${format}`;
  if (presentationExtensions.has(extension)) return `演示文稿 · ${format}`;
  if (imageExtensions.has(extension)) return `图片 · ${format}`;
  if (archiveExtensions.has(extension)) return `压缩包 · ${format}`;
  if (audioExtensions.has(extension)) return `音频 · ${format}`;
  if (videoExtensions.has(extension)) return `视频 · ${format}`;
  if (dataExtensions.has(extension)) return `数据 · ${format}`;
  if (extension === 'html' || extension === 'htm') return `网页 · ${format}`;
  return `文件 · ${format}`;
}

export async function openRuntimeArtifactWithDefaultApp(
  artifact: RuntimeArtifact,
  openWorkspaceFile: WorkspaceArtifactOpener,
): Promise<string | null> {
  const result = await openWorkspaceFile(artifact.workspaceRoot, artifact.path);
  return result.ok ? null : result.error ?? '无法打开文件。';
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
