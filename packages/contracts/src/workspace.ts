export const TEMPORARY_WORKSPACE_PROJECT_ID = 'temporary_workspace';
export const TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX = `${TEMPORARY_WORKSPACE_PROJECT_ID}.`;

export type TemporaryWorkspaceProjectReference = {
  date: string;
  threadId: string;
};

/** Build the opaque workspace id used for one conversation's date-grouped temporary directory. */
export function temporaryWorkspaceProjectId({ date, threadId }: TemporaryWorkspaceProjectReference): string {
  return `${TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX}${date}.${threadId}`;
}

export function parseTemporaryWorkspaceProjectId(projectId: string): TemporaryWorkspaceProjectReference | null {
  if (!projectId.startsWith(TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX)) return null;
  const value = projectId.slice(TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX.length);
  const separator = value.indexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  const date = value.slice(0, separator);
  const threadId = value.slice(separator + 1);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) ? { date, threadId } : null;
}

export function isTemporaryWorkspaceProjectId(projectId: string): boolean {
  return projectId === TEMPORARY_WORKSPACE_PROJECT_ID || parseTemporaryWorkspaceProjectId(projectId) !== null;
}

export const WORKSPACE_PROJECT_NAME_MAX_CHARS = 80;

export function normalizeWorkspaceProjectName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!name) throw new Error('Project name is required.');
  if (Array.from(name).length > WORKSPACE_PROJECT_NAME_MAX_CHARS) {
    throw new Error(`Project name must not exceed ${WORKSPACE_PROJECT_NAME_MAX_CHARS} characters.`);
  }
  return name;
}

/** Names are the portable identity used to reconnect projects across devices. */
export function workspaceProjectNameKey(value: unknown): string {
  return normalizeWorkspaceProjectName(value).normalize('NFKC').toLocaleLowerCase('en-US');
}

export type WorkspaceProject = {
  id: string;
  name: string;
  /** Device-local directory binding. Missing for a restored project awaiting association. */
  path?: string;
  gitRoot?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceProjectList = {
  projects: WorkspaceProject[];
};

export type AddWorkspaceProjectInput = {
  path?: string;
  name?: string;
};

export type UpdateWorkspaceProjectInput = {
  name?: string;
  /** `null` explicitly removes the device-local directory binding. */
  path?: string | null;
};

export type WorkspaceStatus = {
  project?: WorkspaceProject;
  exists: boolean;
  readable: boolean;
  fileCount?: number;
  gitRoot?: string;
};

export type WorkspaceStatusQuery = {
  projectId?: string;
  threadId?: string;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
};

export type WorkspaceEntryList = {
  basePath: string;
  entries: WorkspaceEntry[];
};

export type WorkspaceEntrySearchItem = {
  kind: WorkspaceEntry['type'];
  name: string;
  path: string;
  parent: string;
};

export type WorkspaceEntrySearchResponse = {
  entries: WorkspaceEntrySearchItem[];
  query: string;
  scanned: number;
  truncated: boolean;
  workspaceRoot: string;
};

export type WorkspaceFilePreviewImageMimeType =
  | 'image/bmp'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/svg+xml'
  | 'image/webp'
  | 'image/x-icon';

export type WorkspaceFilePreview =
  | { kind: 'text' }
  | { kind: 'image'; base64: string; mimeType: WorkspaceFilePreviewImageMimeType }
  | { kind: 'unsupported'; reason: 'binary' | 'image-too-large' };

const BINARY_SAMPLE_BYTES = 8 * 1024;
const SVG_SAMPLE_BYTES = 64 * 1024;

/** Detect browser-previewable images by content instead of trusting a spoofable extension. */
export function detectWorkspacePreviewImageMimeType(content: Uint8Array): WorkspaceFilePreviewImageMimeType | null {
  if (startsWithBytes(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(content, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithAscii(content, 'GIF87a') || startsWithAscii(content, 'GIF89a')) return 'image/gif';
  if (startsWithAscii(content, 'RIFF') && matchesAsciiAt(content, 8, 'WEBP')) return 'image/webp';
  if (startsWithAscii(content, 'BM')) return 'image/bmp';
  if (isIcon(content)) return 'image/x-icon';
  if (looksLikeSvg(content)) return 'image/svg+xml';
  return null;
}

/** Classify a bounded content sample before any caller decodes a workspace file as text. */
export function isProbablyBinaryFileContent(content: Uint8Array): boolean {
  if (!content.length) return false;
  const sample = content.subarray(0, Math.min(content.length, BINARY_SAMPLE_BYTES));
  if (hasKnownBinarySignature(sample) || sample.includes(0)) return true;
  if (new TextDecoder().decode(sample).includes('\uFFFD')) return true;

  let controlBytes = 0;
  for (const byte of sample) {
    const allowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d;
    if (!allowedWhitespace && (byte < 0x20 || byte === 0x7f)) controlBytes += 1;
  }
  return controlBytes / sample.length > 0.1;
}

function hasKnownBinarySignature(content: Uint8Array): boolean {
  return startsWithAscii(content, '%PDF-')
    || startsWithAscii(content, 'MZ')
    || startsWithAscii(content, 'Rar!')
    || startsWithBytes(content, [0x7f, 0x45, 0x4c, 0x46])
    || startsWithBytes(content, [0x1f, 0x8b])
    || startsWithBytes(content, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
    || startsWithBytes(content, [0x50, 0x4b, 0x03, 0x04])
    || startsWithBytes(content, [0x50, 0x4b, 0x05, 0x06])
    || startsWithBytes(content, [0x50, 0x4b, 0x07, 0x08]);
}

function startsWithAscii(content: Uint8Array, value: string): boolean {
  return matchesAsciiAt(content, 0, value);
}

function startsWithBytes(content: Uint8Array, value: number[]): boolean {
  return content.length >= value.length && value.every((byte, index) => content[index] === byte);
}

function matchesAsciiAt(content: Uint8Array, offset: number, value: string): boolean {
  if (content.length < offset + value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (content[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function isIcon(content: Uint8Array): boolean {
  return content.length >= 6
    && startsWithBytes(content, [0x00, 0x00, 0x01, 0x00])
    && (content[4] | (content[5] << 8)) > 0;
}

function looksLikeSvg(content: Uint8Array): boolean {
  const source = new TextDecoder()
    .decode(content.subarray(0, Math.min(content.length, SVG_SAMPLE_BYTES)))
    .replace(/^\uFEFF/u, '');
  if (source.includes('\uFFFD') || source.includes('\u0000')) return false;
  return hasSvgRootElement(source);
}

/** Walk the bounded SVG preamble once so crafted comments cannot trigger regex backtracking. */
function hasSvgRootElement(source: string): boolean {
  let cursor = skipWhitespace(source, 0);

  if (startsWithAsciiIgnoreCase(source, cursor, '<?xml')) {
    cursor = indexAfter(source, '>', cursor + '<?xml'.length);
    if (cursor < 0) return false;
    cursor = skipWhitespace(source, cursor);
  }

  while (source.startsWith('<!--', cursor)) {
    cursor = indexAfter(source, '-->', cursor + '<!--'.length);
    if (cursor < 0) return false;
    cursor = skipWhitespace(source, cursor);
  }

  if (startsWithAsciiIgnoreCase(source, cursor, '<!doctype')) {
    cursor += '<!doctype'.length;
    if (!isWhitespace(source[cursor])) return false;
    cursor = skipWhitespace(source, cursor);
    if (!startsWithAsciiIgnoreCase(source, cursor, 'svg')) return false;
    cursor = indexAfter(source, '>', cursor + 'svg'.length);
    if (cursor < 0) return false;
    cursor = skipWhitespace(source, cursor);
  }

  if (!startsWithAsciiIgnoreCase(source, cursor, '<svg')) return false;
  const boundary = source[cursor + '<svg'.length];
  return boundary === '>' || isWhitespace(boundary);
}

function indexAfter(source: string, marker: string, fromIndex: number): number {
  const index = source.indexOf(marker, fromIndex);
  return index < 0 ? -1 : index + marker.length;
}

function skipWhitespace(source: string, fromIndex: number): number {
  let index = fromIndex;
  while (isWhitespace(source[index])) index += 1;
  return index;
}

function startsWithAsciiIgnoreCase(source: string, index: number, expected: string): boolean {
  return source.slice(index, index + expected.length).toLowerCase() === expected;
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && value.trim() === '';
}

/** Maximum text prefix returned by the lightweight file preview request. */
export const WORKSPACE_TEXT_FILE_MAX_BYTES = 256 * 1024;

/** Maximum complete text file loaded into and saved from the workspace editor. */
export const WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES = 8 * 1024 * 1024;

export type WorkspaceFileRead = {
  projectId: string;
  path: string;
  content: string;
  size: number;
  modifiedAt?: string;
  /** Content hash used for optimistic concurrency when saving an editor draft. */
  revision?: string;
  /** Optional for compatibility with runtimes that predate typed file previews. */
  preview?: WorkspaceFilePreview;
  truncated: boolean;
};

export type WorkspaceFileSaveInput = {
  content: string;
  expectedRevision: string;
};

export type WorkspaceFileWrite = {
  projectId: string;
  path: string;
  size: number;
  modifiedAt?: string;
  revision?: string;
  created: boolean;
};

export type WorkspaceSearchResult = {
  path: string;
  line: number;
  preview: string;
};

export type WorkspaceSearchResponse = {
  query: string;
  results: WorkspaceSearchResult[];
  truncated: boolean;
  /** A newer request in the same caller-owned search group replaced this one. */
  superseded?: boolean;
};
