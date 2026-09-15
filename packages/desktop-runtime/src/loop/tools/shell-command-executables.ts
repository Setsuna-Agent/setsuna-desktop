import { parseLiteralShellCommand, type ShellCommandSyntax } from '@setsuna-desktop/contracts';

/**
 * Attribution only: find explicit executables in simple commands, pipelines and
 * POSIX if/loop bodies. Never use this approximation for permission decisions.
 * Script strings, substitutions, functions and heredocs deliberately stay opaque.
 */
export function shellCommandExecutables(command: string, syntax: ShellCommandSyntax): string[] {
  const segments = shellSegments(command, syntax);
  if (!segments) return [];
  return segments.flatMap((words) => {
    const executable = segmentExecutable(words, syntax);
    return executable ? [executable] : [];
  });
}

function shellSegments(command: string, syntax: ShellCommandSyntax): string[][] | null {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote = '';
  const posix = syntax === 'posix';
  const pushWord = () => { if (word) words.push(word); word = ''; };
  const pushSegment = () => { pushWord(); if (words.length) segments.push(words); words = []; };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (!posix && !word && !words.length && /^(?:@?rem(?:\s|$)|::)/iu.test(command.slice(index))) {
      while (index < command.length && command[index] !== '\n') index += 1;
      continue;
    }
    if (posix && char === '\\' && quote !== "'") {
      if (next === undefined) return null;
      if (!quote || next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
        if (next !== '\n') word += char + next;
        index += 1;
        continue;
      }
    }
    if (quote) {
      if (char === quote) quote = '';
      else if (posix && quote === '"' && (char === '`' || (char === '$' && next === '('))) return null;
      word += char;
      continue;
    }
    if (char === '"' || (posix && char === "'")) { quote = char; word += char; continue; }
    if (posix && char === '#' && !word) {
      while (index < command.length && command[index] !== '\n') index += 1;
      pushSegment();
      continue;
    }
    if ('(){}'.includes(char) || char === '`' || (!posix && char === '^') || (char === '<' && next === '<')) return null;
    // An ampersand in a redirection (2>&1, &>file) is not a new command.
    if ((char === '&' && (/[<>]$/u.test(word) || next === '>'))) { word += char; continue; }
    if ('|&\n\r'.includes(char) || (posix && char === ';')) { pushSegment(); continue; }
    if (/\s/u.test(char)) { pushWord(); continue; }
    word += char;
  }
  if (quote) return null;
  pushSegment();
  return segments;
}

function segmentExecutable(words: string[], syntax: ShellCommandSyntax): string | undefined {
  let index = 0;
  if (syntax === 'posix') {
    while (['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!'].includes(words[index])) index += 1;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? '')) index += 1;
    if (['command', 'exec', 'time', 'noglob'].includes(words[index])) {
      index += 1;
      if (words[index] === '--') index += 1;
      // command -v/-V merely looks up a name; unknown wrapper options stay opaque.
      if (words[index]?.startsWith('-')) return undefined;
    }
    if (words[index] === 'env') {
      index += 1;
      while (words[index] === '-i' || words[index] === '--ignore-environment'
        || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? '')) index += 1;
      if (words[index] === '--') index += 1;
      if (words[index]?.startsWith('-')) return undefined;
    }
  } else if (words[index]?.toLowerCase() === 'call') {
    index += 1;
  }
  const literal = parseLiteralShellCommand(words[index] ?? '', syntax);
  return literal?.length === 1 ? literal[0] : undefined;
}
