export type ReusableShellCommand = {
  words: string[];
};

export type ShellCommandStructure = {
  segments: string[];
  hasControlOperators: boolean;
  hasDynamicSyntax: boolean;
};

/** Split top-level shell segments without treating quoted URL characters as operators. */
export function analyzeShellCommandStructure(command: string): ShellCommandStructure {
  const segments: string[] = [];
  let current = '';
  let quote: '' | "'" | '"' = '';
  let escaped = false;
  let hasControlOperators = false;
  let hasDynamicSyntax = false;

  const pushCurrent = () => {
    const segment = current.trim();
    if (segment) segments.push(segment);
    current = '';
  };

  const text = String(command || '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      else if (quote === '"' && (char === '$' || char === '`')) hasDynamicSyntax = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '$' || char === '`') hasDynamicSyntax = true;
    if (char === ';' || char === '&' || char === '|' || char === '\n' || char === '\r') {
      hasControlOperators = true;
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();
  return { segments, hasControlOperators, hasDynamicSyntax };
}

/**
 * Parse the deliberately small shell subset that is safe for reusable prefix
 * approvals. Prefix reuse is an authorization feature, so unsupported shell
 * syntax must fail closed instead of being approximated.
 */
export function parseReusableShellCommand(command: string): ReusableShellCommand | null {
  const words: string[] = [];
  let current = '';
  let quote: '' | "'" | '"' = '';
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    words.push(current);
    current = '';
  };

  const text = String(command || '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (escaped) {
      if (char === '\n' || char === '\r') return null;
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'") quote = '';
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = '';
        continue;
      }
      // Expansion and command substitution make the approved argv unstable.
      if (char === '$' || char === '`') return null;
      if (char === '\\') {
        const next = text[index + 1] ?? '';
        if (next === '\n' || next === '\r') return null;
        // POSIX double quotes only consume a backslash before these four
        // characters. Preserve it otherwise so the approved argv stays exact.
        if ('$`"\\'.includes(next)) escaped = true;
        else current += '\\';
        continue;
      }
      current += char;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (char === '\n' || char === '\r') return null;
      pushCurrent();
      continue;
    }
    if (';&|<>(){}!`$'.includes(char)) return null;
    if (char === '#' && current.length === 0) return null;
    // Globbing can synthesize options or additional operands after approval.
    if (char === '*' || char === '?' || char === '[' || char === ']') return null;
    current += char;
  }

  if (escaped || quote) return null;
  pushCurrent();
  return words.length ? { words } : null;
}

export function reusableShellCommandWords(command: string): string[] {
  return parseReusableShellCommand(command)?.words ?? [];
}
