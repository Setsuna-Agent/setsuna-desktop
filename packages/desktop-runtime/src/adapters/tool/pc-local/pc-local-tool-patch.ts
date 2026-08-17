/** Parsing and application of Codex app-server-style text patches. */

type ApplyPatchOperationBase = {
  path: string;
  moveTo?: string;
};

export type ApplyPatchOperation =
  | (ApplyPatchOperationBase & { type: 'add'; content: string })
  | (ApplyPatchOperationBase & { type: 'delete' })
  | (ApplyPatchOperationBase & { type: 'update'; moveTo: string; chunks: ApplyPatchUpdateChunk[] });

export type ApplyPatchUpdateChunk = {
  /** Optional `@@` anchor, usually a class, function, or method declaration. */
  changeContext: string | null;
  /** Contiguous source lines to locate after changeContext. */
  oldLines: string[];
  /** Replacement lines for oldLines. */
  newLines: string[];
  /** Context-line offsets shared by oldLines and newLines. */
  contextLineIndices: Array<[oldIndex: number, newIndex: number]>;
  /** Whether the old lines should preferentially match the end of the file. */
  isEndOfFile: boolean;
};

export type ParseApplyPatchResult =
  | { ok: true; operations: ApplyPatchOperation[]; environmentId: string }
  | { ok: false; error: string };

export type ApplyPatchHunksResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

type LineReplacement = {
  start: number;
  oldLength: number;
  newLines: string[];
};

export function parseApplyPatch(patch: unknown): ParseApplyPatchResult {
  const text = normalizeApplyPatchText(patch);
  const lines = text.split('\n');
  if (lines[0] !== '*** Begin Patch') {
    return { ok: false, error: 'apply_patch 补丁必须以 *** Begin Patch 开头。' };
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '*** End Patch');
  if (endIndex < 0) return { ok: false, error: 'apply_patch 补丁缺少 *** End Patch。' };
  if (lines.slice(endIndex + 1).some((line) => line.trim())) {
    return { ok: false, error: 'apply_patch 补丁在 *** End Patch 后包含额外内容。' };
  }

  const operations: ApplyPatchOperation[] = [];
  let index = 1;
  let environmentId = '';
  while (index < endIndex) {
    const line = lines[index];
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith('*** Environment ID: ')) {
      if (operations.length) return { ok: false, error: 'apply_patch environment_id must appear before file hunks.' };
      if (environmentId) return { ok: false, error: 'apply_patch environment_id cannot be specified more than once.' };
      environmentId = line.slice('*** Environment ID: '.length).trim();
      if (!environmentId) return { ok: false, error: 'apply_patch environment_id cannot be empty.' };
      index += 1;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const filePath = patchFilePath(line, '*** Add File: ');
      if (!filePath) return { ok: false, error: 'apply_patch Add File 路径不能为空。' };
      const contentLines: string[] = [];
      index += 1;
      while (index < endIndex && !isApplyPatchFileHeader(lines[index])) {
        const contentLine = lines[index];
        if (!contentLine.startsWith('+')) {
          return { ok: false, error: `新增文件 ${filePath} 的内容行必须以 + 开头。` };
        }
        contentLines.push(contentLine.slice(1));
        index += 1;
      }
      operations.push({
        type: 'add',
        path: filePath,
        content: contentLines.length ? `${contentLines.join('\n')}\n` : '',
      });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      const filePath = patchFilePath(line, '*** Delete File: ');
      if (!filePath) return { ok: false, error: 'apply_patch Delete File 路径不能为空。' };
      operations.push({ type: 'delete', path: filePath });
      index += 1;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const filePath = patchFilePath(line, '*** Update File: ');
      if (!filePath) return { ok: false, error: 'apply_patch Update File 路径不能为空。' };
      const chunks: ApplyPatchUpdateChunk[] = [];
      let moveTo = '';
      index += 1;
      if (lines[index]?.startsWith('*** Move to: ')) {
        moveTo = patchFilePath(lines[index], '*** Move to: ');
        if (!moveTo) return { ok: false, error: `更新文件 ${filePath} 的 Move to 路径不能为空。` };
        index += 1;
      }

      while (index < endIndex && !isApplyPatchFileHeader(lines[index])) {
        const hunkLine = lines[index];
        if (hunkLine === '@@' || hunkLine.startsWith('@@ ')) {
          const previous = chunks[chunks.length - 1];
          if (previous && !chunkHasChanges(previous)) {
            return { ok: false, error: `更新文件 ${filePath} 的 hunk 不包含变更行。` };
          }
          const changeContext = hunkLine.slice(3);
          chunks.push(createUpdateChunk(changeContext.trim() ? changeContext : null));
          index += 1;
          continue;
        }
        if (hunkLine === '*** End of File') {
          const chunk = chunks[chunks.length - 1];
          if (!chunk || !chunkHasChanges(chunk)) {
            return { ok: false, error: `更新文件 ${filePath} 的 End of File 前缺少变更行。` };
          }
          chunk.isEndOfFile = true;
          index += 1;
          continue;
        }

        // Codex permits bare blank separators between hunks and file sections.
        // Keep a bare blank as context only when another change follows in this hunk.
        if (hunkLine === '' && !hasFollowingChangeLineInChunk(lines, index, endIndex)) {
          index += 1;
          continue;
        }

        let chunk = chunks[chunks.length - 1];
        if (!chunk || chunk.isEndOfFile) {
          if (chunk?.isEndOfFile && hunkLine === '') {
            index += 1;
            continue;
          }
          if (chunk?.isEndOfFile) {
            return { ok: false, error: `更新文件 ${filePath} 的 End of File 后必须开始新的 @@ hunk。` };
          }
          chunk = createUpdateChunk(null);
          chunks.push(chunk);
        }

        if (hunkLine === '') {
          pushContextLine(chunk, '');
        } else if (hunkLine.startsWith(' ')) {
          pushContextLine(chunk, hunkLine.slice(1));
        } else if (hunkLine.startsWith('+')) {
          chunk.newLines.push(hunkLine.slice(1));
        } else if (hunkLine.startsWith('-')) {
          chunk.oldLines.push(hunkLine.slice(1));
        } else {
          return { ok: false, error: `更新文件 ${filePath} 的变更行必须以空格、+ 或 - 开头。` };
        }
        index += 1;
      }

      if ((!chunks.length && !moveTo) || chunks.some((chunk) => !chunkHasChanges(chunk))) {
        return { ok: false, error: `更新文件 ${filePath} 的 hunk 不包含变更行。` };
      }
      operations.push({ type: 'update', path: filePath, moveTo, chunks });
      continue;
    }
    return { ok: false, error: `无法识别的 apply_patch 行：${line}` };
  }
  return { ok: true, operations, environmentId };
}

function createUpdateChunk(changeContext: string | null): ApplyPatchUpdateChunk {
  return {
    changeContext,
    oldLines: [],
    newLines: [],
    contextLineIndices: [],
    isEndOfFile: false,
  };
}

function pushContextLine(chunk: ApplyPatchUpdateChunk, line: string): void {
  chunk.contextLineIndices.push([chunk.oldLines.length, chunk.newLines.length]);
  chunk.oldLines.push(line);
  chunk.newLines.push(line);
}

function chunkHasChanges(chunk: ApplyPatchUpdateChunk): boolean {
  return chunk.oldLines.length !== chunk.contextLineIndices.length
    || chunk.newLines.length !== chunk.contextLineIndices.length;
}

function hasFollowingChangeLineInChunk(lines: readonly string[], currentIndex: number, endIndex: number): boolean {
  for (let index = currentIndex + 1; index < endIndex; index += 1) {
    const line = lines[index];
    if (line === '@@' || line.startsWith('@@ ') || line === '*** End of File' || isApplyPatchFileHeader(line)) {
      return false;
    }
    if (line.startsWith('+') || line.startsWith('-')) return true;
  }
  return false;
}

function patchFilePath(line: string, marker: string): string {
  return line.slice(marker.length).trim();
}

function normalizeApplyPatchText(patch: unknown): string {
  const text = String(patch || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = text.split('\n');
  if (lines[0] === '*** Begin Patch') return text;
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (
    lines.length >= 4
    && (first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"')
    && String(last || '').endsWith('EOF')
  ) {
    return lines.slice(1, -1).join('\n').trim();
  }
  return text;
}

function isApplyPatchFileHeader(line: unknown): boolean {
  return String(line || '').startsWith('*** Add File: ')
    || String(line || '').startsWith('*** Update File: ')
    || String(line || '').startsWith('*** Delete File: ');
}

export function applyPatchHunks(
  content: unknown,
  chunks: ReadonlyArray<ApplyPatchUpdateChunk>,
  label: string,
): ApplyPatchHunksResult {
  const original = String(content || '');
  if (!chunks.length) return { ok: true, content: original };
  const useCrLf = /\r\n/.test(original);
  const normalized = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const hasFinalNewline = normalized.endsWith('\n');
  const lines = normalized ? normalized.split('\n') : [];
  if (hasFinalNewline) lines.pop();

  const replacements: LineReplacement[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    if (chunk.changeContext !== null) {
      const contextIndex = seekSequence(lines, [chunk.changeContext], cursor, false);
      if (contextIndex === null) {
        return { ok: false, error: `补丁无法应用到 ${label}：未找到上下文 ${JSON.stringify(chunk.changeContext)}。` };
      }
      cursor = contextIndex + 1;
    }

    if (!chunk.oldLines.length) {
      // Codex treats addition-only update chunks as appends, including chunks with an @@ anchor.
      const insertionIndex = lines.length;
      replacements.push({ start: insertionIndex, oldLength: 0, newLines: [...chunk.newLines] });
      continue;
    }

    const start = seekSequence(lines, chunk.oldLines, cursor, chunk.isEndOfFile);
    if (start === null) {
      return {
        ok: false,
        error: `补丁无法应用到 ${label}：未找到匹配的旧内容。\n${chunk.oldLines.join('\n')}`,
      };
    }
    pushContextPreservingReplacements(replacements, chunk, start);
    cursor = start + chunk.oldLines.length;
  }

  const nextLines = [...lines];
  replacements.sort((left, right) => left.start - right.start);
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index];
    nextLines.splice(replacement.start, replacement.oldLength, ...replacement.newLines);
  }
  let nextContent = nextLines.join('\n');
  // Codex update patches normalize every non-empty result to a terminated text file.
  if (nextLines.length) nextContent += '\n';
  if (useCrLf) nextContent = nextContent.replace(/\n/g, '\r\n');
  return { ok: true, content: nextContent };
}

/** Preserve matched context verbatim while replacing only added/removed segments. */
function pushContextPreservingReplacements(
  replacements: LineReplacement[],
  chunk: ApplyPatchUpdateChunk,
  start: number,
): void {
  let oldStart = 0;
  let newStart = 0;
  for (const [oldContext, newContext] of chunk.contextLineIndices) {
    if (oldContext >= chunk.oldLines.length || newContext >= chunk.newLines.length) break;
    if (oldStart !== oldContext || newStart !== newContext) {
      replacements.push({
        start: start + oldStart,
        oldLength: oldContext - oldStart,
        newLines: chunk.newLines.slice(newStart, newContext),
      });
    }
    oldStart = oldContext + 1;
    newStart = newContext + 1;
  }
  if (oldStart !== chunk.oldLines.length || newStart !== chunk.newLines.length) {
    replacements.push({
      start: start + oldStart,
      oldLength: chunk.oldLines.length - oldStart,
      newLines: chunk.newLines.slice(newStart),
    });
  }
}

/** Match Codex apply_patch context from strict to progressively more tolerant forms. */
function seekSequence(
  lines: readonly string[],
  pattern: readonly string[],
  start: number,
  endOfFile: boolean,
): number | null {
  if (!pattern.length) return Math.min(start, lines.length);
  if (pattern.length > lines.length) return null;
  const lastStart = lines.length - pattern.length;
  const searchStart = Math.max(0, start);
  if (searchStart > lastStart) return null;
  const ranges: Array<[from: number, to: number]> = endOfFile
    ? [[lastStart, lastStart]]
    : [[searchStart, lastStart]];

  const matchers: Array<(value: string) => string> = [
    (value) => value,
    (value) => value.trimEnd(),
    (value) => value.trim(),
    normalizePatchMatchText,
  ];
  for (const normalize of matchers) {
    for (const [from, to] of ranges) {
      for (let index = from; index <= to; index += 1) {
        if (pattern.every((expected, offset) => normalize(lines[index + offset]) === normalize(expected))) {
          return index;
        }
      }
    }
  }
  return null;
}

function normalizePatchMatchText(value: string): string {
  return value.trim()
    .replace(/[‐‑‒–—―−]/gu, '-')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, ' ');
}
