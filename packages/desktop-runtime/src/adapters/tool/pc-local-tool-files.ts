// @ts-nocheck

/** Workspace file discovery, reading, mutation, and preview calculation. */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildFileMentionIndex, findFileMentionSuggestions, invalidateFileMentionIndex } from './file-mentions.js';
import {
  MAX_TEXT_BYTES,
  MAX_LIST_ENTRIES,
  DEFAULT_FIND_RESULTS,
  MAX_FIND_RESULTS,
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_CONTEXT_LINES,
  IGNORED_DIRS,
} from './pc-local-tool-constants.js';
import {
  countOccurrences,
  boundedInteger,
  integerOrNull,
  truncateText,
  okResult,
  errorResult,
} from './pc-local-tool-utils.js';
import {
  parseApplyPatch,
  applyPatchHunks,
} from './pc-local-tool-patch.js';
import {
  resolveWorkspacePath,
  resolveWorkspacePathFromBase,
  resolveReadablePath,
  deniedSandboxRuleForPath,
  workspaceRelativePath,
  formatPath,
  formatAccessiblePath,
  normalizePermissionProfile,
} from './pc-local-tool-paths.js';
import {
  patchDiffFromDiffs,
  buildFileDiff,
  buildDeletedFileDiff,
} from './pc-local-tool-diff.js';

export async function listDirectory(args, state) {
  const dirPath = resolveReadablePath(args?.path || '.', state);
  const info = await stat(dirPath);
  if (!info.isDirectory()) return errorResult(`Path is not a directory: ${formatAccessiblePath(dirPath, state)}`);

  const entries = await readdir(dirPath, { withFileTypes: true });
  const sorted = entries
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  const visible = sorted.slice(0, MAX_LIST_ENTRIES);
  const lines = visible.map((entry) => `${entry.isDirectory() ? '[DIR] ' : '      '}${entry.name}`);
  if (sorted.length > visible.length) lines.push(`... ${sorted.length - visible.length} more entries`);

  return okResult(
    `Directory listing for ${formatAccessiblePath(dirPath, state)}:\n${lines.join('\n') || '(empty)'}`,
    `listed ${formatAccessiblePath(dirPath, state)}`,
  );
}

export async function findFiles(args, state) {
  const query = String(args?.query ?? '');
  const maxResults = boundedInteger(args?.max_results, DEFAULT_FIND_RESULTS, 1, MAX_FIND_RESULTS);
  const scopePath = args?.path ? resolveWorkspacePath(args.path, state.root) : state.root;
  if (deniedSandboxRuleForPath(scopePath, state)) {
    return errorResult(`Search path is denied by sandbox filesystem policy: ${formatPath(scopePath, state.root)}`);
  }
  const scopeInfo = await stat(scopePath);
  if (!scopeInfo.isDirectory()) return errorResult(`Search path is not a directory: ${formatPath(scopePath, state.root)}`);

  const index = await buildFileMentionIndex(state.root);
  const scopedIndex = filterFilesByScope(index, scopePath, state.root)
    .filter((file) => !deniedSandboxRuleForPath(path.join(state.root, ...file.path.split('/')), state));
  const matches = findFileMentionSuggestions(scopedIndex, query, maxResults);
  const files = matches.map((file) => file.path);

  return okResult(
    [
      `File search for ${JSON.stringify(query)} under ${formatPath(scopePath, state.root)}:`,
      files.join('\n') || '(no matches)',
      `Searched ${scopedIndex.length} indexed file${scopedIndex.length === 1 ? '' : 's'} in scope.`,
    ].join('\n'),
    `found ${files.length} files`,
  );
}

export async function searchText(args, state, signal) {
  const query = String(args?.query ?? '');
  if (!query) return errorResult('Search query cannot be empty.');

  const maxResults = boundedInteger(args?.max_results, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  const contextLines = boundedInteger(args?.context_lines, 0, 0, MAX_SEARCH_CONTEXT_LINES);
  const regex = args?.regex !== false;
  const scopePath = args?.path ? resolveWorkspacePath(args.path, state.root) : state.root;
  if (deniedSandboxRuleForPath(scopePath, state)) {
    return errorResult(`Search path is denied by sandbox filesystem policy: ${formatPath(scopePath, state.root)}`);
  }
  if (!state.workspaceSearchEngine) return errorResult('Workspace search engine is unavailable.');
  const appliesSandboxDenyRules = normalizePermissionProfile(state.permissionProfile) !== 'danger-full-access';
  const response = await state.workspaceSearchEngine.search({
    root: state.root,
    scopePath,
    query,
    regex,
    caseSensitive: Boolean(args?.case_sensitive),
    contextLines,
    maxResults,
    excludeRoots: appliesSandboxDenyRules ? state.sandboxWorkspaceWrite?.deniedRoots : [],
    excludeGlobs: appliesSandboxDenyRules ? state.sandboxWorkspaceWrite?.deniedGlobPatterns : [],
    signal,
  });
  const matcherLabel = `${regex ? 'regex ' : ''}${JSON.stringify(query)}`;
  const details = response.scannedFiles === undefined
    ? `Engine: ${response.engine}.`
    : `Scanned ${response.scannedFiles} file${response.scannedFiles === 1 ? '' : 's'} using ${response.engine}.`;
  return okResult(
    truncateText([
      `Text search for ${matcherLabel} under ${formatPath(scopePath, state.root)}: ${response.matches.length} match${response.matches.length === 1 ? '' : 'es'}`,
      response.matches.map(formatSearchMatch).join('\n') || '(no matches)',
      response.truncated ? `Showing first ${maxResults} matches.` : '',
      details,
    ].filter(Boolean).join('\n'), MAX_TEXT_BYTES),
    `found ${response.matches.length} text matches`,
  );
}

export async function readLocalFile(args, state) {
  const filePath = resolveReadablePath(args?.file_path, state);
  const info = await stat(filePath);
  if (!info.isFile()) return errorResult(`Path is not a file: ${formatAccessiblePath(filePath, state)}`);

  const content = await readFile(filePath, 'utf8');
  rememberRead(state, filePath, info);

  const range = normalizeReadRange(args);
  let body = content;
  let prefix = `File: ${formatAccessiblePath(filePath, state)}`;
  if (range) {
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, range.offset - 1);
    const end = range.limit === null ? lines.length : Math.min(lines.length, start + range.limit);
    body = lines
      .slice(start, end)
      .map((line, index) => `${start + index + 1}: ${line}`)
      .join('\n');
    prefix += ` (lines ${start + 1}-${end} of ${lines.length})`;
  }

  rememberReadFileResult(state, filePath, info, range, 'runtime');
  return okResult(`${prefix}\n${truncateText(body, MAX_TEXT_BYTES)}`, `read ${formatAccessiblePath(filePath, state)}`);
}

export async function applyLocalPatch(args, state) {
  const result = await calculateApplyPatch(args, state);
  if (!result.ok) return errorResult(result.error);

  for (const change of result.changes) {
    if (change.action === 'delete') {
      await rm(change.filePath);
      state.reads.delete(change.filePath);
      continue;
    }
    await mkdir(path.dirname(change.filePath), { recursive: true });
    await writeFile(change.filePath, change.nextContent, 'utf8');
    rememberRead(state, change.filePath, await stat(change.filePath));
  }
  invalidateFileMentionIndex(state.root);

  return okResult(
    `Successfully applied patch to ${result.changes.length} file${result.changes.length === 1 ? '' : 's'}.`,
    result.changes.length === 1
      ? `patched ${result.diffs[0].path}`
      : `patched ${result.changes.length} files`,
    result.diff ? { diff: result.diff } : {},
  );
}

export async function writeLocalFile(args, state) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const content = String(args?.content ?? '');
  let existed = false;
  let existingStats = null;
  let previousContent = '';

  try {
    existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) return errorResult(`Path is not a writable file: ${formatPath(filePath, state.root)}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existed) {
    previousContent = await readFile(filePath, 'utf8');
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  invalidateFileMentionIndex(state.root);
  rememberRead(state, filePath, await stat(filePath));

  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent,
    nextContent: content,
  });
  return okResult(
    existed
      ? `Successfully overwrote file: ${formatPath(filePath, state.root)}.`
      : `Successfully created and wrote to new file: ${formatPath(filePath, state.root)}.`,
    `${existed ? 'wrote' : 'created'} ${formatPath(filePath, state.root)}`,
    diff.additions || diff.deletions ? { diff } : {},
  );
}

export async function calculateApplyPatch(args, state) {
  const operations = parseApplyPatch(String(args?.patch || ''));
  if (!operations.ok) return operations;
  const requestedEnvironmentId = String(args?.environment_id ?? args?.environmentId ?? '').trim();
  const patchEnvironmentId = operations.environmentId || '';
  const activeEnvironmentId = String(state.environmentId || '').trim();
  const environmentId = requestedEnvironmentId || patchEnvironmentId;
  if (requestedEnvironmentId && patchEnvironmentId && requestedEnvironmentId !== patchEnvironmentId) {
    return { ok: false, error: `apply_patch environment_id mismatch: argument ${requestedEnvironmentId} does not match patch preamble ${patchEnvironmentId}.` };
  }
  if (environmentId && activeEnvironmentId && environmentId !== activeEnvironmentId) {
    return { ok: false, error: `apply_patch environment_id ${environmentId} does not match active environment ${activeEnvironmentId}.` };
  }
  if (environmentId && !activeEnvironmentId) {
    return { ok: false, error: `apply_patch environment_id ${environmentId} cannot be used without an active environment.` };
  }
  const patchRoot = args?.workdir ? resolveWorkspacePath(args.workdir, state.root) : state.root;

  const changes = [];
  const touched = new Set();
  for (const operation of operations.operations) {
    const filePath = resolveWorkspacePathFromBase(operation.path, patchRoot, state.root);
    if (touched.has(filePath)) return { ok: false, error: `同一个补丁中重复修改了文件：${formatPath(filePath, state.root)}` };
    touched.add(filePath);

    if (operation.type === 'add') {
      if (existsSync(filePath)) return { ok: false, error: `文件已存在，无法新增：${formatPath(filePath, state.root)}` };
      changes.push({
        action: 'write',
        filePath,
        existed: false,
        previousContent: '',
        nextContent: operation.content,
      });
      continue;
    }

    const moveToPath = operation.moveTo ? resolveWorkspacePathFromBase(operation.moveTo, patchRoot, state.root) : null;
    if (moveToPath) {
      if (touched.has(moveToPath)) return { ok: false, error: `同一个补丁中重复修改了文件：${formatPath(moveToPath, state.root)}` };
      touched.add(moveToPath);
      if (existsSync(moveToPath)) return { ok: false, error: `目标文件已存在，无法移动到：${formatPath(moveToPath, state.root)}` };
    }
    const info = await stat(filePath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return { ok: false, error: `找不到文件，无法${operation.type === 'delete' ? '删除' : '修改'}：${formatPath(filePath, state.root)}` };
    if (!info.isFile()) return { ok: false, error: `Path is not a file: ${formatPath(filePath, state.root)}` };

    const previousContent = await readFile(filePath, 'utf8');
    if (operation.type === 'delete') {
      changes.push({
        action: 'delete',
        filePath,
        existed: true,
        previousContent,
        nextContent: '',
      });
      continue;
    }

    const update = applyPatchHunks(previousContent, operation.hunks, formatPath(filePath, state.root));
    if (!update.ok) return update;
    if (!moveToPath && update.content === previousContent) return { ok: false, error: `补丁没有改变文件：${formatPath(filePath, state.root)}` };
    if (moveToPath) {
      changes.push({
        action: 'delete',
        filePath,
        existed: true,
        previousContent,
        nextContent: '',
      });
      changes.push({
        action: 'write',
        filePath: moveToPath,
        existed: false,
        previousContent: '',
        nextContent: update.content,
      });
      continue;
    }
    changes.push({
      action: 'write',
      filePath,
      existed: true,
      previousContent,
      nextContent: update.content,
    });
  }

  if (!changes.length) return { ok: false, error: '补丁中没有可应用的文件变更。' };

  const diffs = changes.map((change) =>
    change.action === 'delete'
      ? buildDeletedFileDiff({
          filePath: change.filePath,
          root: state.root,
          previousContent: change.previousContent,
        })
      : buildFileDiff({
          filePath: change.filePath,
          root: state.root,
          existed: change.existed,
          previousContent: change.previousContent,
          nextContent: change.nextContent,
        })
  );
  return {
    ok: true,
    changes,
    diffs,
    diff: patchDiffFromDiffs(diffs),
  };
}

export async function appendLocalFile(args, state) {
  const result = await calculateAppendFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return errorResult(result.error);

  await mkdir(path.dirname(result.filePath), { recursive: true });
  await writeFile(result.filePath, result.nextContent, 'utf8');
  invalidateFileMentionIndex(state.root);
  rememberRead(state, result.filePath, await stat(result.filePath));

  return okResult(
    result.existed
      ? `Successfully appended to file: ${formatPath(result.filePath, state.root)}.`
      : `Successfully created and wrote to new file: ${formatPath(result.filePath, state.root)}.`,
    `${result.existed ? 'appended' : 'created'} ${formatPath(result.filePath, state.root)}`,
    result.diff.additions || result.diff.deletions ? { diff: result.diff } : {},
  );
}

export async function deleteLocalFile(args, state) {
  const result = await calculateDeleteFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return errorResult(result.error);

  await rm(result.filePath);
  invalidateFileMentionIndex(state.root);
  state.reads.delete(result.filePath);

  return okResult(
    `Successfully deleted file: ${formatPath(result.filePath, state.root)}.`,
    `deleted ${formatPath(result.filePath, state.root)}`,
    { diff: result.diff },
  );
}

export async function editLocalFile(args, state) {
  const result = await calculateEditFile(normalizeEditArgs(args), state, { enforcePriorRead: false });
  if (!result.ok) return errorResult(result.error);

  await mkdir(path.dirname(result.filePath), { recursive: true });
  await writeFile(result.filePath, result.nextContent, 'utf8');
  invalidateFileMentionIndex(state.root);
  rememberRead(state, result.filePath, await stat(result.filePath));

  return okResult(
    result.existed
      ? `Successfully edited file: ${formatPath(result.filePath, state.root)}.`
      : `Successfully created file: ${formatPath(result.filePath, state.root)}.`,
    `${result.existed ? 'edited' : 'created'} ${formatPath(result.filePath, state.root)}`,
    result.diff.additions || result.diff.deletions ? { diff: result.diff } : {},
  );
}

export async function calculateEditFile(args, state, options = {}) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const oldString = String(args?.old_string ?? '');
  const newString = String(args?.new_string ?? '');
  const replaceAll = Boolean(args?.replace_all);
  let existed = false;
  let existingStats = null;
  let previousContent = '';

  try {
    existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) {
      return { ok: false, error: `Path is not a writable file: ${formatPath(filePath, state.root)}` };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (!existed) {
    if (oldString !== '') return { ok: false, error: `找不到文件，无法编辑：${formatPath(filePath, state.root)}` };
    const diff = buildFileDiff({
      filePath,
      root: state.root,
      existed,
      previousContent: '',
      nextContent: newString,
    });
    return { ok: true, filePath, existed, nextContent: newString, diff };
  }

  if (options.enforcePriorRead) {
    const guard = await priorReadGuard(state, filePath, existingStats, '编辑');
    if (guard) return { ok: false, error: guard.display };
  }

  previousContent = await readFile(filePath, 'utf8');
  if (oldString === '') return { ok: false, error: `文件已存在，无法按新建方式写入：${formatPath(filePath, state.root)}` };
  if (oldString === newString) return { ok: false, error: '没有需要应用的变化。' };

  const occurrences = countOccurrences(previousContent, oldString);
  if (!occurrences) {
    return {
      ok: false,
      error: `没有在 ${formatPath(filePath, state.root)} 中找到要替换的内容，请检查空格、缩进和上下文。`,
    };
  }
  if (!replaceAll && occurrences > 1) {
    return {
      ok: false,
      error: `要替换的内容在 ${formatPath(filePath, state.root)} 中匹配了 ${occurrences} 处，请提供更精确的上下文或明确批量替换。`,
    };
  }

  const nextContent = replaceAll
    ? previousContent.split(oldString).join(newString)
    : previousContent.replace(oldString, newString);
  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent,
    nextContent,
  });
  return { ok: true, filePath, existed, nextContent, diff };
}

export async function calculateAppendFile(args, state, options = {}) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const content = String(args?.content ?? '');
  let existed = false;
  let existingStats = null;
  let previousContent = '';

  try {
    existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) {
      return { ok: false, error: `Path is not a writable file: ${formatPath(filePath, state.root)}` };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existed) {
    if (options.enforcePriorRead) {
      const guard = await priorReadGuard(state, filePath, existingStats, '追加');
      if (guard) return { ok: false, error: guard.display };
    }
    previousContent = await readFile(filePath, 'utf8');
  }

  const nextContent = `${previousContent}${content}`;
  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent,
    nextContent,
  });
  return { ok: true, filePath, existed, nextContent, diff };
}

export async function calculateDeleteFile(args, state, options = {}) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  let existingStats = null;

  try {
    existingStats = await stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, error: `找不到文件，无法删除：${formatPath(filePath, state.root)}` };
    }
    /* node:coverage ignore next */
    throw error;
  }

  if (!existingStats.isFile()) {
    return { ok: false, error: `Path is not a deletable file: ${formatPath(filePath, state.root)}` };
  }
  if (options.enforcePriorRead) {
    const guard = await priorReadGuard(state, filePath, existingStats, '删除');
    if (guard) return { ok: false, error: guard.display };
  }

  const previousContent = await readFile(filePath, 'utf8');
  const diff = buildDeletedFileDiff({
    filePath,
    root: state.root,
    previousContent,
  });
  return { ok: true, filePath, diff };
}

function filterFilesByScope(index, scopePath, root) {
  const scope = workspaceRelativePath(scopePath, root);
  if (scope === '.') return index;
  const prefix = `${scope}/`;
  return index.filter((file) => file.path === scope || file.path.startsWith(prefix));
}

export function normalizeEditArgs(args = {}) {
  return {
    ...args,
    old_string: Object.hasOwn(args, 'old_string') ? args.old_string : args.old_text,
    new_string: Object.hasOwn(args, 'new_string') ? args.new_string : args.new_text,
  };
}

export function normalizeReadRange(args = {}) {
  const offset = integerOrNull(args.offset);
  const limit = integerOrNull(args.limit);
  if (offset !== null || limit !== null) {
    return { offset: offset || 1, limit };
  }
  const startLine = integerOrNull(args.start_line);
  const endLine = integerOrNull(args.end_line);
  if (startLine === null && endLine === null) return null;
  const start = startLine || 1;
  const normalizedEnd = endLine === null ? null : Math.max(start, endLine);
  return {
    offset: start,
    limit: normalizedEnd === null ? null : normalizedEnd - start + 1,
  };
}

function formatSearchMatch(match) {
  const lines = [];
  match.before.forEach((line, index) => {
    lines.push(`${match.path}-${match.beforeStart + index}-${line}`);
  });
  lines.push(`${match.path}:${match.lineNumber}:${match.column}: ${match.line}`);
  match.after.forEach((line, index) => {
    lines.push(`${match.path}-${match.lineNumber + index + 1}-${line}`);
  });
  return lines.join('\n');
}

async function priorReadGuard(state, filePath, currentStats, verb) {
  const previousRead = state.reads?.get(filePath);
  if (!previousRead) return errorResult(`请先查看 ${formatPath(filePath, state.root)}，再${verb}它。`);
  if (previousRead.mtimeMs !== currentStats.mtimeMs || previousRead.size !== currentStats.size) {
    return errorResult(`${formatPath(filePath, state.root)} 在上次查看后发生了变化，请重新查看后再${verb}。`);
  }
  return null;
}

export function rememberRead(state, filePath, info) {
  state.reads?.set(filePath, {
    mtimeMs: info.mtimeMs,
    size: info.size,
  });
}

export function rememberReadFileResult(state, filePath, info, range, source) {
  if (!state.readFileResults) state.readFileResults = new Map();
  state.readFileResults.set(readFileResultCacheKey(filePath, range), {
    mtimeMs: info.mtimeMs,
    size: info.size,
    source,
  });
}

export function rememberedReadFileResult(state, filePath, info, range) {
  const entry = state.readFileResults?.get(readFileResultCacheKey(filePath, range));
  if (!entry) return null;
  if (entry.mtimeMs !== info.mtimeMs || entry.size !== info.size) return null;
  return entry;
}

function readFileResultCacheKey(filePath, range) {
  if (!range) return `${filePath}\0full`;
  return `${filePath}\0${range.offset || 1}\0${range.limit ?? 'end'}`;
}

export function isEditToolName(name) {
  return name === 'edit' || name === 'edit_file';
}

function shouldIgnoreEntry(name) {
  return IGNORED_DIRS.has(name) || name === '.DS_Store';
}
