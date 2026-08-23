import type {
  RuntimeMemoryFileSearchMatch,
  RuntimeMemorySearchMatchMode,
} from '@setsuna-desktop/feature-memory/contracts';

export function normalizeSearchMatchMode(
  value: RuntimeMemorySearchMatchMode | undefined,
): RuntimeMemorySearchMatchMode {
  if (value === 'all_on_same_line' || value === 'any') return value;
  if (value && typeof value === 'object' && value.type === 'all_within_lines') {
    return { type: 'all_within_lines', lineCount: Math.max(1, Math.floor(value.lineCount)) };
  }
  return 'any';
}

export function searchMemoryLines(input: {
  caseSensitive: boolean;
  contextLines: number;
  lines: string[];
  mode: RuntimeMemorySearchMatchMode;
  path: string;
  queries: string[];
}): RuntimeMemoryFileSearchMatch[] {
  const haystackLines = input.caseSensitive ? input.lines : input.lines.map((line) => line.toLowerCase());
  const queries = input.caseSensitive ? input.queries : input.queries.map((query) => query.toLowerCase());
  const matchedFlags = haystackLines.map((line) => queries.map((query) => line.includes(query)));
  const matches: RuntimeMemoryFileSearchMatch[] = [];
  if (input.mode === 'any') {
    for (let index = 0; index < input.lines.length; index += 1) {
      const flags = matchedFlags[index];
      if (flags.some(Boolean)) matches.push(memorySearchMatch(input, index, index, matchedQueries(input.queries, flags)));
    }
    return matches;
  }
  if (input.mode === 'all_on_same_line') {
    for (let index = 0; index < input.lines.length; index += 1) {
      const flags = matchedFlags[index];
      if (flags.every(Boolean)) matches.push(memorySearchMatch(input, index, index, matchedQueries(input.queries, flags)));
    }
    return matches;
  }

  const lineCount = input.mode.lineCount;
  for (let start = 0; start < input.lines.length; start += 1) {
    const aggregate = queries.map(() => false);
    const endLimit = Math.min(input.lines.length - 1, start + lineCount - 1);
    for (let end = start; end <= endLimit; end += 1) {
      matchedFlags[end].forEach((flag, index) => {
        aggregate[index] ||= flag;
      });
      if (aggregate.every(Boolean)) {
        matches.push(memorySearchMatch(input, start, end, matchedQueries(input.queries, aggregate)));
        break;
      }
    }
  }
  return matches;
}

export function memorySearchMatch(
  input: { contextLines: number; lines: string[]; path: string },
  matchStartIndex: number,
  matchEndIndex: number,
  matchedQueries: string[],
): RuntimeMemoryFileSearchMatch {
  const contentStartIndex = Math.max(0, matchStartIndex - input.contextLines);
  const contentEndIndex = Math.min(input.lines.length - 1, matchEndIndex + input.contextLines);
  return {
    path: input.path,
    matchLineNumber: matchStartIndex + 1,
    contentStartLineNumber: contentStartIndex + 1,
    content: input.lines.slice(contentStartIndex, contentEndIndex + 1).join('\n'),
    matchedQueries,
  };
}

export function matchedQueries(queries: string[], flags: boolean[]): string[] {
  return queries.filter((_query, index) => flags[index]);
}
