export function escapeSkillAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}

export function neutralizeSkillTags(value: string): string {
  return neutralizePromptClosingTags(value, ['skill']);
}

export function neutralizeMemoryTags(value: string): string {
  return neutralizePromptClosingTags(value, ['memory']);
}

export function neutralizePersonalizationTags(value: string): string {
  return neutralizePromptClosingTags(value, ['memory', 'skill']);
}

export function neutralizeMailboxTags(value: string): string {
  return neutralizePromptClosingTags(value, ['mailbox_message']);
}

export function neutralizeInstructionTags(value: string): string {
  return neutralizePromptClosingTags(value, ['instructions']);
}

export function neutralizePromptClosingTags(value: string, tagNames: readonly string[]): string {
  if (!value || !tagNames.length) return value;
  const alternatives = tagNames.map(escapeRegExp).join('|');
  return value.replace(new RegExp(`</(?:${alternatives})`, 'giu'), (match) => `<\\/${match.slice(2)}`);
}

export function parseJsonObjectFromText(value: string): Record<string, unknown> | null {
  const direct = tryParseJsonObject(value);
  if (direct) return direct;
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return tryParseJsonObject(value.slice(start, end + 1));
}

export function parseJsonArrayFromText(value: string): unknown[] {
  const text = stripMarkdownFence(value).trim();
  const direct = tryParseJsonArray(text);
  if (direct) return direct;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  return tryParseJsonArray(text.slice(start, end + 1)) ?? [];
}

export function stringFromRecord(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function stringArrayFromRecord(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

export function stripMarkdownFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

/**
 * 压缩长文本供 prompt 使用，保留头尾以兼顾背景和错误尾部。
 */
export function compactForPrompt(value: string, maxChars: number): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 48);
  return `${normalized.slice(0, head)}\n...[omitted ${normalized.length - head - tail} chars]...\n${normalized.slice(-tail)}`;
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function tryParseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
