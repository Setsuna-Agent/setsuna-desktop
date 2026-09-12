import { parseLiteralShellCommand, type ShellCommandSyntax } from './literal-command.js';

export type RipgrepCommand = {
  kind: 'files' | 'text';
  query: string;
  paths: string[];
  /** Includes pattern/ignore files, which also require filesystem read access. */
  readPaths: string[];
};

const LONG_FLAGS = new Set([
  'files', 'hidden', 'no-hidden', 'no-ignore', 'no-ignore-vcs', 'no-ignore-parent',
  'no-ignore-global', 'no-ignore-dot', 'no-ignore-exclude', 'no-ignore-files',
  'ignore-case', 'case-sensitive', 'smart-case', 'fixed-strings', 'line-number',
  'no-line-number', 'with-filename', 'no-filename', 'files-with-matches',
  'files-without-match', 'count', 'count-matches', 'only-matching', 'word-regexp',
  'line-regexp', 'invert-match', 'multiline', 'multiline-dotall', 'pcre2',
  'no-pcre2', 'text', 'follow', 'null', 'null-data', 'json', 'heading',
  'no-heading', 'no-config', 'trim', 'no-messages', 'stats', 'quiet', 'crlf',
  'unicode', 'no-unicode', 'no-require-git', 'max-columns-preview',
]);
const LONG_VALUE_OPTIONS = new Set([
  'regexp', 'file', 'glob', 'iglob', 'type', 'type-not', 'after-context',
  'before-context', 'context', 'max-count', 'max-columns', 'max-filesize',
  'encoding', 'color', 'colors', 'sort', 'sortr', 'threads', 'max-depth',
  'engine', 'ignore-file', 'path-separator',
]);
const SHORT_FLAGS = new Set('nisSFlLcowlxvUPaHINq0u'.split(''));
const SHORT_VALUE_OPTIONS: Record<string, string> = {
  e: 'regexp', f: 'file', g: 'glob', t: 'type', T: 'type-not',
  A: 'after-context', B: 'before-context', C: 'context',
  m: 'max-count', M: 'max-columns', j: 'threads', E: 'encoding',
};

/**
 * Recognize literal rg invocations with ordinary search options. Unknown options
 * (including subprocess hooks such as --pre) and shell programs stay opaque.
 * This describes argv; callers must still enforce exec policy and OS permissions.
 */
export function parseRipgrepCommand(
  command: string,
  syntax: ShellCommandSyntax = 'posix',
): RipgrepCommand | null {
  const words = parseLiteralShellCommand(command, syntax);
  if (!words || !/^(?:rg|rg\.exe)$/iu.test(words[0]!.replace(/\\/gu, '/').split('/').at(-1)!)) return null;
  const patterns: string[] = [];
  const globs: string[] = [];
  const inputs: string[] = [];
  const paths: string[] = [];
  let hasPatternFile = false;
  let files = false;
  let positional = false;

  const optionValue = (name: string, value: string) => {
    if (name === 'regexp') patterns.push(value);
    if (name === 'glob' || name === 'iglob') globs.push(value);
    if (name === 'file' || name === 'ignore-file') inputs.push(value);
    if (name === 'file') hasPatternFile = true;
  };

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (!positional && word === '--') {
      positional = true;
      continue;
    }
    if (positional || !word.startsWith('-') || word === '-') {
      paths.push(word);
      continue;
    }
    if (word.startsWith('--')) {
      const separator = word.indexOf('=');
      const name = word.slice(2, separator < 0 ? undefined : separator);
      if (LONG_FLAGS.has(name) && separator < 0) {
        if (name === 'files') files = true;
        continue;
      }
      if (!LONG_VALUE_OPTIONS.has(name)) return null;
      const value = separator < 0 ? words[++index] : word.slice(separator + 1);
      if (value === undefined) return null;
      optionValue(name, value);
      continue;
    }
    for (let offset = 1; offset < word.length; offset += 1) {
      const flag = word[offset]!;
      if (SHORT_FLAGS.has(flag)) continue;
      const name = SHORT_VALUE_OPTIONS[flag];
      if (!name) return null;
      const value = word.slice(offset + 1) || words[++index];
      if (value === undefined) return null;
      optionValue(name, value);
      break;
    }
  }
  if (!files && !patterns.length && !hasPatternFile) {
    const pattern = paths.shift();
    if (pattern === undefined) return null;
    patterns.push(pattern);
  }
  return {
    kind: files ? 'files' : 'text',
    query: (files ? globs : patterns).join(' | '),
    paths,
    readPaths: [...paths, ...inputs],
  };
}
