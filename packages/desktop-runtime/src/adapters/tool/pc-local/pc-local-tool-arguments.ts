/** Parsers for complete and streaming local-tool arguments. */

import { errorMessage } from '../../../shared/node-errors.js';
import { recordInput } from '../../../shared/unknown.js';
import type {
  FileDiff,
  FileDiffAction,
  PatchDiff,
} from './pc-local-tool-diff.js';
import {
  escapeRegExp,
} from './pc-local-tool-utils.js';

export type ParsedToolArguments =
  | { args: Record<string, unknown>; error?: never }
  | { args?: never; error: string };

type PatchPreviewAction = 'create' | 'edit' | 'append' | 'delete';

type PatchPreviewFile = {
  file_path: string;
  action: PatchPreviewAction;
  additions: number;
  deletions: number;
};

type PartialFileDiff = FileDiff & { partial: true };
type PartialPatchDiff = PatchDiff & { action: 'Planned'; partial: true };

export function parseToolArguments(toolCall: unknown): ParsedToolArguments {
  try {
    const call = recordInput(toolCall);
    const fn = recordInput(call.function);
    const args = JSON.parse(String(fn.arguments || '{}')) as unknown;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { error: '工具参数必须是 JSON 对象。' };
    }
    return { args: args as Record<string, unknown> };
  } catch (error) {
    return { error: `工具参数不是有效 JSON：${errorMessage(error)}` };
  }
}

export function parsePartialWriteFileArguments(rawArguments: string) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const input = parsed as Record<string, unknown>;
      return {
        file_path: String(input.file_path || input.path || ''),
        ...(Object.hasOwn(input, 'path') ? { path: input.path } : {}),
        content: String(input.content ?? ''),
        complete: true,
      };
    }
  } catch {
    // 工具参数以不完整 JSON 流入，继续交由扫描器处理。
  }

  const filePath = findJsonFilePathValue(raw);
  const content = findJsonStringValue(raw, 'content');
  if (!filePath && !content) return null;
  return {
    file_path: filePath?.match.value || '',
    ...(filePath?.usedPathAlias ? { path: filePath.match.value || '' } : {}),
    content: content?.value || '',
    complete: false,
  };
}

export function parsePartialApplyPatchArguments(rawArguments: string) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const input = parsed as Record<string, unknown>;
      const files = applyPatchPreviewFiles(String(input.patch || ''));
      const currentFile = files[files.length - 1] || null;
      const preview = partialPatchPreviewFromFiles(files);
      return {
        file_path: currentFile?.file_path || '',
        files,
        complete: true,
        preview,
      };
    }
  } catch {
    // 工具参数以不完整 JSON 流入，继续交由扫描器处理。
  }

  const patch = findJsonStringValue(raw, 'patch');
  const files = applyPatchPreviewFiles(patch?.value || raw);
  if (!files.length) return null;
  const currentFile = files[files.length - 1] || null;
  const preview = partialPatchPreviewFromFiles(files);
  return {
    file_path: currentFile?.file_path || '',
    files,
    complete: false,
    preview,
  };
}

export function parsePartialAppendFileArguments(rawArguments: string) {
  return parsePartialWriteFileArguments(rawArguments);
}

export function parsePartialDeleteFileArguments(rawArguments: string) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const input = parsed as Record<string, unknown>;
      return {
        file_path: String(input.file_path || input.path || ''),
        ...(Object.hasOwn(input, 'path') ? { path: input.path } : {}),
        complete: true,
      };
    }
  } catch {
    // 工具参数以不完整 JSON 流入，继续交由扫描器处理。
  }

  const filePath = findJsonFilePathValue(raw);
  if (!filePath) return null;
  return {
    file_path: filePath.match.value || '',
    ...(filePath.usedPathAlias ? { path: filePath.match.value || '' } : {}),
    complete: false,
  };
}

export function parsePartialEditFileArguments(rawArguments: string) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const input = parsed as Record<string, unknown>;
      return {
        file_path: String(input.file_path || input.path || ''),
        ...(Object.hasOwn(input, 'path') ? { path: input.path } : {}),
        old_string: String(input.old_string ?? ''),
        new_string: String(input.new_string ?? ''),
        replace_all: Boolean(input.replace_all),
        has_old_string: Object.hasOwn(input, 'old_string'),
        has_new_string: Object.hasOwn(input, 'new_string'),
        file_path_closed: true,
        old_string_closed: true,
        new_string_closed: true,
        complete: true,
      };
    }
  } catch {
    // 工具参数以不完整 JSON 流入，继续交由扫描器处理。
  }

  const filePath = findJsonFilePathValue(raw);
  const oldString = findJsonStringValue(raw, 'old_string');
  const newString = findJsonStringValue(raw, 'new_string');
  if (!filePath && !oldString && !newString) return null;
  return {
    file_path: filePath?.match.value || '',
    ...(filePath?.usedPathAlias ? { path: filePath.match.value || '' } : {}),
    old_string: oldString?.value || '',
    new_string: newString?.value || '',
    replace_all: false,
    has_old_string: Boolean(oldString),
    has_new_string: Boolean(newString),
    file_path_closed: Boolean(filePath?.match.closed),
    old_string_closed: Boolean(oldString?.closed),
    new_string_closed: Boolean(newString?.closed),
    complete: false,
  };
}

function applyPatchPreviewFiles(patch: unknown): PatchPreviewFile[] {
  const files: PatchPreviewFile[] = [];
  const byPath = new Map<string, PatchPreviewFile>();
  const pushFile = (filePath: unknown, action: unknown): PatchPreviewFile | null => {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return null;
    const existing = byPath.get(normalizedPath);
    if (existing) return existing;
    const file = {
      file_path: normalizedPath,
      action: normalizePatchPreviewAction(action),
      additions: 0,
      deletions: 0,
    };
    byPath.set(normalizedPath, file);
    files.push(file);
    return file;
  };
  let currentFile: PatchPreviewFile | null = null;

  String(patch || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('*** Add File: ')) {
        currentFile = pushFile(trimmed.slice('*** Add File: '.length), 'create');
      } else if (trimmed.startsWith('*** Update File: ')) {
        currentFile = pushFile(trimmed.slice('*** Update File: '.length), 'edit');
      } else if (trimmed.startsWith('*** Delete File: ')) {
        currentFile = pushFile(trimmed.slice('*** Delete File: '.length), 'delete');
      } else if (currentFile && trimmed.startsWith('+')) {
        currentFile.additions += 1;
      } else if (currentFile && trimmed.startsWith('-')) {
        currentFile.deletions += 1;
      }
    });

  return files;
}

function normalizePatchPreviewAction(value: unknown): PatchPreviewAction {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'create' || action === 'edit' || action === 'append' || action === 'delete') {
    return action;
  }
  return 'edit';
}

function partialPatchPreviewFromFiles(
  files: PatchPreviewFile[],
): PartialFileDiff | PartialPatchDiff | null {
  const diffs: PartialFileDiff[] = files
    .filter((file) => file?.file_path)
    .map((file) => ({
      type: 'file_diff' as const,
      action: patchPreviewDiffAction(file.action),
      path: String(file.file_path).replace(/\\/g, '/'),
      additions: Number(file.additions || 0),
      deletions: Number(file.deletions || 0),
      truncated: false,
      partial: true as const,
      lines: [],
    }));
  if (!diffs.length) return null;
  if (diffs.length === 1) return diffs[0];
  return {
    type: 'patch_diff',
    action: 'Planned',
    path: `${diffs.length} files`,
    additions: 0,
    deletions: 0,
    partial: true,
    diffs,
  };
}

function patchPreviewDiffAction(action: PatchPreviewAction): FileDiffAction {
  if (action === 'create') return 'Created';
  if (action === 'delete') return 'Deleted';
  return 'Edited';
}

function findJsonStringValue(raw: string, key: string): { value: string; closed: boolean } | null {
  const matcher = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`);
  const match = matcher.exec(raw);
  if (!match) return null;
  return readJsonStringAt(raw, match.index + match[0].length - 1);
}

function findJsonFilePathValue(
  raw: string,
): { match: { value: string; closed: boolean }; usedPathAlias: boolean } | null {
  const match = findJsonStringValue(raw, 'file_path');
  if (match) return { match, usedPathAlias: false };
  const pathMatch = findJsonStringValue(raw, 'path');
  return pathMatch ? { match: pathMatch, usedPathAlias: true } : null;
}

function readJsonStringAt(raw: string, quoteIndex: number): { value: string; closed: boolean } {
  let value = '';
  let escaped = false;
  for (let index = quoteIndex + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      if (char === 'n') value += '\n';
      else if (char === 'r') value += '\r';
      else if (char === 't') value += '\t';
      else if (char === 'b') value += '\b';
      else if (char === 'f') value += '\f';
      else if (char === 'u') {
        const hex = raw.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
        }
      } else {
        value += char;
      }
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return { value, closed: true };
    }
    value += char;
  }
  return { value, closed: false };
}
