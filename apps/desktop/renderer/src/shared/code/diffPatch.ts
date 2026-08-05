export type CodeDiffLine = {
  type: 'added' | 'removed' | 'context' | 'gap';
  content: string;
  oldLine?: number;
  newLine?: number;
};

type CodeDiffPatchInput = {
  action?: string | null;
  lines: readonly CodeDiffLine[];
  path: string;
};

/** Convert projected line data back into a valid patch for Pierre's PatchDiff. */
export function codeDiffLinesToPatch({ action, lines, path }: CodeDiffPatchInput): string {
  const safePath = path.replace(/[\r\n]/gu, '');
  const created = action === 'Created';
  const deleted = action === 'Deleted';
  const patch = [
    `diff --git a/${safePath} b/${safePath}`,
    ...(created ? ['new file mode 100644'] : []),
    ...(deleted ? ['deleted file mode 100644'] : []),
    created ? '--- /dev/null' : `--- a/${safePath}`,
    deleted ? '+++ /dev/null' : `+++ b/${safePath}`,
  ];

  for (const segment of contiguousDiffSegments(lines)) {
    const oldCount = segment.reduce((count, line) => count + (line.type === 'added' ? 0 : 1), 0);
    const newCount = segment.reduce((count, line) => count + (line.type === 'removed' ? 0 : 1), 0);
    const oldStart = diffSideStart(segment, 'old', created);
    const newStart = diffSideStart(segment, 'new', deleted);
    patch.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    segment.forEach((line) => {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      patch.push(`${prefix}${line.content}`);
    });
  }

  return patch.join('\n');
}

function contiguousDiffSegments(lines: readonly CodeDiffLine[]): CodeDiffLine[][] {
  const segments: CodeDiffLine[][] = [];
  let current: CodeDiffLine[] = [];
  for (const line of lines) {
    if (line.type === 'gap') {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) segments.push(current);
  return segments;
}

function diffSideStart(
  lines: readonly CodeDiffLine[],
  side: 'new' | 'old',
  emptyFileSide: boolean,
): number {
  if (emptyFileSide) return 0;
  const property = side === 'old' ? 'oldLine' : 'newLine';
  const direct = lines.find((line) => line[property] !== undefined)?.[property];
  if (direct !== undefined) return direct;

  const oppositeProperty = side === 'old' ? 'newLine' : 'oldLine';
  const opposite = lines.find((line) => line[oppositeProperty] !== undefined)?.[oppositeProperty];
  return opposite === undefined ? 0 : Math.max(0, opposite - 1);
}
