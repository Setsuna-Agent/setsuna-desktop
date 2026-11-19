import type { DesignTextRun } from './document.js';

type RunStyle = Omit<DesignTextRun, 'start' | 'end'>;

function mergeTextRuns(runs: readonly DesignTextRun[]): DesignTextRun[] {
  const merged: DesignTextRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous?.end === run.start && previous.color === run.color && previous.styleId === run.styleId
      && previous.fontFamily === run.fontFamily && previous.fontSize === run.fontSize && previous.fontWeight === run.fontWeight) {
      merged[merged.length - 1] = { ...previous, end: run.end };
    } else if (run.color || run.styleId || run.fontFamily || run.fontSize !== undefined || run.fontWeight !== undefined) merged.push(run);
  }
  return merged;
}

export function updateDesignTextRange(
  runs: readonly DesignTextRun[], start: number, end: number, style?: RunStyle,
): readonly DesignTextRun[] {
  if (end <= start) return runs;
  const boundaries = [...new Set([start, end, ...runs.flatMap((run) => [run.start, run.end])])].sort((a, b) => a - b);
  let current = 0;
  return mergeTextRuns(boundaries.slice(0, -1).flatMap((from, index) => {
    const to = boundaries[index + 1];
    while (current < runs.length && runs[current].end <= from) current += 1;
    const source = runs[current]?.start <= from ? runs[current] : undefined;
    if (from >= start && to <= end) return style ? [{ ...source, ...style, start: from, end: to }] : [];
    return source ? [{ ...source, start: from, end: to }] : [];
  }));
}

export function rebaseDesignTextRuns(before: string, after: string, runs: readonly DesignTextRun[] | undefined) {
  if (!runs?.length || before === after) return runs;
  let prefix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix += 1;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
  const delta = newEnd - oldEnd;
  return mergeTextRuns(runs.flatMap((run): DesignTextRun[] => {
    if (run.end <= prefix) return [run];
    if (run.start <= prefix && run.end >= oldEnd && (oldEnd > prefix || run.start < prefix)) {
      return run.end + delta > run.start ? [{ ...run, end: run.end + delta }] : [];
    }
    if (run.start >= oldEnd) return [{ ...run, start: run.start + delta, end: run.end + delta }];
    return [
      ...(run.start < prefix ? [{ ...run, end: prefix }] : []),
      ...(run.end > oldEnd ? [{ ...run, start: newEnd, end: run.end + delta }] : []),
    ];
  }));
}
