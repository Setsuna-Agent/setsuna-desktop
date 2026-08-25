const MAX_DEBUG_STRING_LENGTH = 8_000;
const MAX_DEBUG_STRING_SCAN_LENGTH = MAX_DEBUG_STRING_LENGTH * 2;
const MAX_DEBUG_ARRAY_ITEMS = 200;
const MAX_DEBUG_OBJECT_DEPTH = 12;
const SENSITIVE_NORMALIZED_KEYS = new Set([
  'authorization',
  'proxyauthorization',
]);
const SENSITIVE_NORMALIZED_KEY_SUFFIX_PATTERN =
  /(?:accesskey(?:id)?|apikey|cookie|credential|credentials|passwd|password|privatekey|secret|token)$/u;
const DATA_URL_PATTERN =
  /data:([^;,\s"'<>]+)(?:;[^,\s"'<>]*)?,[^\s"'<>}\]]+/giu;

export function safeConversationDebugJson(value: unknown): string {
  return JSON.stringify(sanitizeConversationDebugValue(value), null, 2);
}

export function sanitizeConversationDebugValue(
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (isSensitiveDebugKey(key)) return '[redacted]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'string') {
    return sanitizeConversationDebugTextAtDepth(value, depth, seen);
  }
  if (depth >= MAX_DEBUG_OBJECT_DEPTH) return '[depth limit]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DEBUG_ARRAY_ITEMS)
      .map((item) => sanitizeConversationDebugValue(item, '', depth + 1, seen));
    if (value.length > MAX_DEBUG_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_DEBUG_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeConversationDebugValue(entryValue, entryKey, depth + 1, seen),
    ]),
  );
}

export function sanitizeConversationDebugText(value: string): string {
  return sanitizeConversationDebugTextAtDepth(value, 0, new WeakSet<object>());
}

function sanitizeConversationDebugTextAtDepth(
  value: string,
  depth: number,
  seen: WeakSet<object>,
): string {
  // Tool arguments and results can be arbitrarily large or contain a partial
  // streamed JSON string. Bound all parsing and scanning before touching the
  // content so malformed input cannot monopolize the renderer.
  const scannedValue = value.slice(0, MAX_DEBUG_STRING_SCAN_LENGTH);
  const unscannedLength = value.length - scannedValue.length;
  let normalized = scannedValue;
  if (unscannedLength === 0 && depth < MAX_DEBUG_OBJECT_DEPTH) {
    const embeddedJson = parseEmbeddedDebugJson(scannedValue);
    if (embeddedJson !== undefined) {
      normalized = JSON.stringify(
        sanitizeConversationDebugValue(embeddedJson, '', depth + 1, seen),
      );
    }
  }

  const redacted = normalized
    .replace(DATA_URL_PATTERN, (match, mediaType: string) => (
      `[data URL omitted: ${mediaType}, ${match.length} chars]`
    ))
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/giu, '[redacted api key]');
  const assignmentRedacted = redactSensitiveAssignments(redacted);
  const omittedLength = unscannedLength
    + Math.max(0, assignmentRedacted.length - MAX_DEBUG_STRING_LENGTH);
  if (!omittedLength) return assignmentRedacted;
  return `${assignmentRedacted.slice(0, MAX_DEBUG_STRING_LENGTH)}\n…[${omittedLength} chars omitted]`;
}

function isSensitiveDebugKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return Boolean(
    normalized
    && (
      SENSITIVE_NORMALIZED_KEYS.has(normalized)
      || SENSITIVE_NORMALIZED_KEY_SUFFIX_PATTERN.test(normalized)
    )
  );
}

function parseEmbeddedDebugJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}'))
    && !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

type DebugAssignment = {
  key: string;
  valueStart: number;
};

/**
 * Redact key/value assignments with a single forward scan. A regex that tries
 * to parse quoted values can backtrack exponentially on partial streamed JSON
 * such as `token="\\\\...`, which would freeze the renderer.
 */
function redactSensitiveAssignments(value: string): string {
  let cursor = 0;
  let index = 0;
  let output = '';
  while (index < value.length) {
    const assignment = debugAssignmentAt(value, index);
    if (!assignment || !isSensitiveDebugKey(assignment.key)) {
      index += 1;
      continue;
    }
    const valueEnd = debugAssignmentValueEnd(value, assignment.valueStart);
    output += `${value.slice(cursor, assignment.valueStart)}"[redacted]"`;
    cursor = valueEnd;
    index = valueEnd;
  }
  return output ? output + value.slice(cursor) : value;
}

function debugAssignmentAt(value: string, start: number): DebugAssignment | null {
  const first = value[start];
  let key = '';
  let index = start;

  if (first === '"' || first === "'") {
    const quote = first;
    index += 1;
    const keyStart = index;
    while (index < value.length && value[index] !== quote) {
      if (!isDebugKeyCharacter(value[index]) || index - keyStart >= 80) return null;
      index += 1;
    }
    if (index >= value.length || index === keyStart) return null;
    key = value.slice(keyStart, index);
    index += 1;
  } else {
    if (!isAsciiLetter(first)) return null;
    const keyStart = index;
    index += 1;
    while (
      index < value.length
      && isDebugKeyCharacter(value[index])
      && index - keyStart < 80
    ) {
      index += 1;
    }
    key = value.slice(keyStart, index);
  }

  while (index < value.length && isDebugWhitespace(value[index])) index += 1;
  if (value[index] !== ':' && value[index] !== '=') return null;
  index += 1;
  while (index < value.length && isDebugWhitespace(value[index])) index += 1;
  if (index >= value.length) return null;
  return { key, valueStart: index };
}

function debugAssignmentValueEnd(value: string, start: number): number {
  const quote = value[start] === '"' || value[start] === "'" ? value[start] : null;
  if (!quote) {
    let index = start;
    while (
      index < value.length
      && !isDebugWhitespace(value[index])
      && value[index] !== ','
      && value[index] !== '}'
      && value[index] !== ']'
    ) {
      index += 1;
    }
    return index;
  }

  let index = start + 1;
  while (index < value.length) {
    if (value[index] === '\\') {
      index = Math.min(value.length, index + 2);
    } else if (value[index] === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return value.length;
}

function isAsciiLetter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDebugKeyCharacter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  return isAsciiLetter(value)
    || (code >= 48 && code <= 57)
    || value === '_'
    || value === '.'
    || value === '-';
}

function isDebugWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r';
}
