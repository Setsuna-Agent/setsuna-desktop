// @ts-nocheck

/** Parsers for complete and streaming local-tool arguments. */

import {
  escapeRegExp,
} from './pc-local-tool-utils.js';

export function parseToolArguments(toolCall) {
  try {
    const args = JSON.parse(String(toolCall?.function?.arguments || '{}'));
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { error: '工具参数必须是 JSON 对象。' };
    }
    return { args };
  } catch (error) {
    return { error: `工具参数不是有效 JSON：${error.message || String(error)}` };
  }
}

export function parsePartialWriteFileArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        file_path: String(parsed.file_path || parsed.path || ''),
        ...(Object.hasOwn(parsed, 'path') ? { path: parsed.path } : {}),
        content: String(parsed.content ?? ''),
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

export function parsePartialApplyPatchArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const files = applyPatchPreviewFiles(String(parsed.patch || ''));
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

export function parsePartialAppendFileArguments(rawArguments) {
  return parsePartialWriteFileArguments(rawArguments);
}

export function parsePartialDeleteFileArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        file_path: String(parsed.file_path || parsed.path || ''),
        ...(Object.hasOwn(parsed, 'path') ? { path: parsed.path } : {}),
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

export function parsePartialEditFileArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        file_path: String(parsed.file_path || parsed.path || ''),
        ...(Object.hasOwn(parsed, 'path') ? { path: parsed.path } : {}),
        old_string: String(parsed.old_string ?? ''),
        new_string: String(parsed.new_string ?? ''),
        replace_all: Boolean(parsed.replace_all),
        has_old_string: Object.hasOwn(parsed, 'old_string'),
        has_new_string: Object.hasOwn(parsed, 'new_string'),
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

function applyPatchPreviewFiles(patch) {
  const files = [];
  const byPath = new Map();
  const pushFile = (filePath, action) => {
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
  let currentFile = null;

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

function normalizePatchPreviewAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'create' || action === 'edit' || action === 'append' || action === 'delete') {
    return action;
  }
  return 'edit';
}

function partialPatchPreviewFromFiles(files) {
  const diffs = (files || [])
    .filter((file) => file?.file_path)
    .map((file) => ({
      type: 'file_diff',
      action: patchPreviewDiffAction(file.action),
      path: String(file.file_path).replace(/\\/g, '/'),
      additions: Number(file.additions || 0),
      deletions: Number(file.deletions || 0),
      truncated: false,
      partial: true,
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

function patchPreviewDiffAction(action) {
  if (action === 'create') return 'Created';
  if (action === 'delete') return 'Deleted';
  return 'Edited';
}

function findJsonStringValue(raw, key) {
  const matcher = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`);
  const match = matcher.exec(raw);
  if (!match) return null;
  return readJsonStringAt(raw, match.index + match[0].length - 1);
}

function findJsonFilePathValue(raw) {
  const match = findJsonStringValue(raw, 'file_path');
  if (match) return { match, usedPathAlias: false };
  const pathMatch = findJsonStringValue(raw, 'path');
  return pathMatch ? { match: pathMatch, usedPathAlias: true } : null;
}

function readJsonStringAt(raw, quoteIndex) {
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
