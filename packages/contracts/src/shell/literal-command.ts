export type ShellCommandSyntax = 'posix' | 'cmd';

/** Parse one literal command. Operators, expansion and incomplete input fail closed. */
export function parseLiteralShellCommand(command: string, syntax: ShellCommandSyntax = 'posix'): string[] | null {
  if (syntax === 'cmd') return parseCmdCommand(command);
  const words: string[] = [];
  let current = '';
  let quote: '' | "'" | '"' = '';
  let escaped = false;
  let wordStarted = false;

  const pushCurrent = () => {
    if (!wordStarted) return;
    words.push(current);
    current = '';
    wordStarted = false;
  };

  const text = String(command || '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped || quote || !/\s/u.test(char)) wordStarted = true;

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
  return words.length ? words : null;
}

// cmd.exe has different quoting and expansion rules. Accept only the literal
// subset needed by direct commands; ^ escapes and %/! expansion stay opaque.
function parseCmdCommand(command: string): string[] | null {
  if (/[&|<>()^%!$`\r\n]/u.test(command)) return null;
  const words: string[] = [];
  let word = '';
  let quoted = false;
  let started = false;
  for (const char of command) {
    if (char === '"') {
      // Backslash/quote handling differs between cmd and Windows argv parsers.
      if (word.endsWith('\\')) return null;
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/u.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      if (!quoted && /[*?]/u.test(char)) return null;
      word += char;
      started = true;
    }
  }
  if (quoted) return null;
  if (started) words.push(word);
  return words.length ? words : null;
}
