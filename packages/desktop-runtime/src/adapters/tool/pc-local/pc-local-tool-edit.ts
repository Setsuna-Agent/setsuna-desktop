/** Validate targeted edits and locate every replacement against one source snapshot. */

export type TextEdit = { old_string: string; new_string: string };
export type TextEditRequest = { edits: TextEdit[]; replaceAll: boolean; allowCreate: boolean };
type EditFailure = { ok: false; error: string };
type Replacement = { start: number; end: number; text: string; editIndex: number };

export function parseTextEditRequest(args: Record<string, unknown>):
  | { ok: true; request: TextEditRequest }
  | EditFailure {
  const hasBatch = Object.hasOwn(args, 'edits');
  const hasLegacy = ['old_string', 'new_string', 'old_text', 'new_text', 'replace_all']
    .some((key) => Object.hasOwn(args, key));
  if (hasBatch && hasLegacy) return { ok: false, error: 'edits 不能与单次替换参数混用。' };
  if (hasBatch && (!Array.isArray(args.edits) || !args.edits.length)) {
    return { ok: false, error: 'edits 必须是至少包含一组替换的数组。' };
  }
  if (!hasBatch && args.replace_all !== undefined && typeof args.replace_all !== 'boolean') {
    return { ok: false, error: 'replace_all 必须是布尔值。' };
  }
  // Old calls and persisted integrations can still use the single-replacement form.
  const entries: unknown[] = hasBatch ? args.edits as unknown[] : [{
    old_string: Object.hasOwn(args, 'old_string') ? args.old_string : args.old_text,
    new_string: Object.hasOwn(args, 'new_string') ? args.new_string : args.new_text,
  }];
  const edits: TextEdit[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `edits[${index}] 必须包含 old_string 和 new_string。` };
    }
    const { old_string, new_string } = entry as Record<string, unknown>;
    if (typeof old_string !== 'string' || typeof new_string !== 'string') {
      return { ok: false, error: `edits[${index}].old_string 和 new_string 必须是字符串；删除内容请明确传入空字符串 new_string。` };
    }
    if (hasBatch && !old_string.length) {
      return { ok: false, error: `edits[${index}].old_string 不能为空；新文件使用 write_file。` };
    }
    edits.push({ old_string, new_string });
  }
  return { ok: true, request: { edits, replaceAll: args.replace_all === true, allowCreate: !hasBatch } };
}

export function applyTextEdits(content: string, request: TextEditRequest, label: string):
  | { ok: true; content: string }
  | EditFailure {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  // Keep the BOM in the matching view so text copied from read_file still
  // matches literally, including when the first line occurs again later.
  const source = content;
  const crlfOffsets: number[] = [];
  const normalized = source.replace(/\r\n|\r/g, (ending, offset: number) => {
    if (ending === '\r\n') crlfOffsets.push(offset - crlfOffsets.length);
    return '\n';
  });
  const ending = source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const replacements: Replacement[] = [];
  for (const [editIndex, edit] of request.edits.entries()) {
    const oldText = normalizeNewlines(edit.old_string);
    if (!oldText) return { ok: false, error: `edits[${editIndex}].old_string 不能为空：${label}` };
    const newText = normalizeNewlines(edit.new_string);
    const replacementText = newText.replace(/\n/g, () => ending);
    let offset = 0;
    let matches = 0;
    while (offset <= normalized.length - oldText.length) {
      const start = normalized.indexOf(oldText, offset);
      if (start < 0) break;
      matches += 1;
      if (!request.replaceAll && matches > 1) {
        return { ok: false, error: `edits[${editIndex}] 在 ${label} 中匹配了多处；请提供更精确的上下文。` };
      }
      const originalStart = originalOffset(start, crlfOffsets);
      const originalEnd = originalOffset(start + oldText.length, crlfOffsets);
      const atFileStart = bom.length > 0 && originalStart <= bom.length;
      const replacementStart = atFileStart ? bom.length : originalStart;
      // Preserve the file marker outside the replaced range. Only at that
      // boundary is a leading BOM in replacement text redundant; elsewhere
      // U+FEFF remains literal source text.
      const matchedText = bom && originalStart === 0 ? stripBom(oldText) : oldText;
      const insertedText = atFileStart ? stripBom(newText) : newText;
      replacements.push({
        start: replacementStart,
        end: originalEnd,
        // A no-op entry must not silently rewrite mixed line endings.
        text: matchedText === insertedText ? source.slice(replacementStart, originalEnd)
          : atFileStart ? stripBom(replacementText) : replacementText,
        editIndex,
      });
      // Count overlapping occurrences as ambiguous too; legacy replace_all keeps
      // its non-overlapping string-replacement semantics.
      offset = start + (request.replaceAll ? oldText.length : 1);
    }
    if (!matches) {
      return { ok: false, error: `没有在 ${label} 中找到 edits[${editIndex}] 的原文，请检查空格、缩进和上下文。` };
    }
  }
  replacements.sort((left, right) => left.start - right.start);
  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1];
    const current = replacements[index];
    if (previous.end > current.start) {
      return { ok: false, error: `edits[${previous.editIndex}] 与 edits[${current.editIndex}] 在 ${label} 中范围重叠；请合并为一组替换。` };
    }
  }
  // Join slices from the original once: repeated full-file splicing is quadratic
  // for replace_all. Untouched BOM, mixed line endings and whitespace stay exact.
  const parts: string[] = [];
  let cursor = 0;
  for (const replacement of replacements) {
    parts.push(source.slice(cursor, replacement.start), replacement.text);
    cursor = replacement.end;
  }
  parts.push(source.slice(cursor));
  const result = parts.join('');
  return result === content
    ? { ok: false, error: `没有需要应用的变化：${label}` }
    : { ok: true, content: result };
}

function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/** Each CRLF before a normalized offset contributes one extra original code unit. */
function originalOffset(offset: number, crlfOffsets: readonly number[]): number {
  let left = 0;
  let right = crlfOffsets.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (crlfOffsets[middle] < offset) left = middle + 1;
    else right = middle;
  }
  return offset + left;
}
