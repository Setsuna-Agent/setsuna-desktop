import type { DesktopDiffFile, DesktopDiffLine, DesktopDiffSummary } from '../contracts/index.js';

export const MAX_DIFF_LINES_PER_FILE = 2500;

export function parseUnifiedDiff(output: string): DesktopDiffSummary {
  const files: DesktopDiffFile[] = [];
  let current: DesktopDiffFile | null = null;
  let currentPatchLines: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let truncated = false;

  const finishCurrentFile = () => {
    if (!current) return;
    if (!current.truncated && !current.contentKind) {
      current.patch = currentPatchLines.join('\n');
    }
    files.push(current);
  };

  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      finishCurrentFile();
      const diffPaths = parseDiffPaths(rawLine);
      current = {
        path: diffPaths.path,
        ...(diffPaths.previousPath ? { previousPath: diffPaths.previousPath } : {}),
        action: 'Modified',
        additions: 0,
        deletions: 0,
        truncated: false,
        lines: [],
      };
      currentPatchLines = [rawLine];
      oldLine = 0;
      newLine = 0;
      truncated = false;
      continue;
    }
    if (!current) continue;
    // Truncated previews are rebuilt from their bounded line list in the
    // renderer, so retaining the remaining raw patch only duplicates data.
    if (!current.truncated) currentPatchLines.push(rawLine);
    if (rawLine.startsWith('new file mode')) current.action = 'Created';
    if (rawLine.startsWith('deleted file mode')) current.action = 'Deleted';
    if (rawLine.startsWith('rename from ')) {
      current.action = 'Renamed';
      current.previousPath = decodeGitPath(rawLine.slice('rename from '.length));
    }
    if (rawLine.startsWith('rename to ')) current.path = decodeGitPath(rawLine.slice('rename to '.length));
    if (rawLine.startsWith('Binary files ') || rawLine === 'GIT binary patch') {
      current.contentKind = 'binary';
      current.lines = [];
      continue;
    }
    if (oldLine === 0 && newLine === 0 && (rawLine.startsWith('--- ') || rawLine.startsWith('+++ '))) {
      const headerPath = decodeGitPath(rawLine.slice(4).replace(/\t$/u, ''));
      if (headerPath !== '/dev/null' && (rawLine.startsWith('+++ ') || current.action === 'Deleted')) {
        current.path = headerPath.slice(2);
      }
    }
    if (rawLine.startsWith('@@ ')) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        const nextOldLine = Number(match[1]);
        const nextNewLine = Number(match[2]);
        const hiddenLineCount = omittedUnmodifiedLineCount({
          previousOldLine: oldLine,
          previousNewLine: newLine,
          nextOldLine,
          nextNewLine,
        });
        if (current.lines.length > 0 && hiddenLineCount > 0) {
          pushDiffLine(current, {
            type: 'gap',
            lineNumber: current.lines.length + 1,
            content: formatUnmodifiedLineGap(hiddenLineCount),
          }, truncated);
          truncated = current.truncated;
        }
        oldLine = nextOldLine;
        newLine = nextNewLine;
      }
      continue;
    }
    if (rawLine.startsWith('---') || rawLine.startsWith('+++') || rawLine.startsWith('index ')) continue;

    if (rawLine.startsWith('+')) {
      current.additions += 1;
      pushDiffLine(current, {
        type: 'added',
        lineNumber: current.lines.length + 1,
        newLine,
        content: rawLine.slice(1),
      }, truncated);
      newLine += 1;
      truncated = current.truncated;
      continue;
    }
    if (rawLine.startsWith('-')) {
      current.deletions += 1;
      pushDiffLine(current, {
        type: 'removed',
        lineNumber: current.lines.length + 1,
        oldLine,
        content: rawLine.slice(1),
      }, truncated);
      oldLine += 1;
      truncated = current.truncated;
      continue;
    }
    if (rawLine.startsWith(' ')) {
      pushDiffLine(current, {
        type: 'context',
        lineNumber: current.lines.length + 1,
        oldLine,
        newLine,
        content: rawLine.slice(1),
      }, truncated);
      oldLine += 1;
      newLine += 1;
    }
    truncated = current.truncated;
  }

  finishCurrentFile();
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

function omittedUnmodifiedLineCount({
  previousOldLine,
  previousNewLine,
  nextOldLine,
  nextNewLine,
}: {
  previousOldLine: number;
  previousNewLine: number;
  nextOldLine: number;
  nextNewLine: number;
}): number {
  if (!previousOldLine || !previousNewLine) return 0;
  const oldGap = nextOldLine - previousOldLine;
  const newGap = nextNewLine - previousNewLine;
  return Math.max(0, Math.max(oldGap, newGap));
}

function formatUnmodifiedLineGap(count: number): string {
  return `${count} unmodified ${count === 1 ? 'line' : 'lines'}`;
}

function pushDiffLine(file: DesktopDiffFile, line: DesktopDiffLine, alreadyTruncated: boolean): void {
  if (alreadyTruncated || file.lines.length >= MAX_DIFF_LINES_PER_FILE) {
    file.truncated = true;
    return;
  }
  file.lines.push(line);
}

function parseDiffPaths(line: string): { path: string; previousPath?: string } {
  const match = line.match(/^diff --git (a\/.+|"(?:[^"\\]|\\.)*") (b\/.+|"(?:[^"\\]|\\.)*")$/u);
  if (!match) return { path: line.replace(/^diff --git /, '') };
  const before = decodeGitPath(match[1]).slice(2);
  const after = decodeGitPath(match[2]).slice(2);
  return {
    path: after,
    ...(before !== after ? { previousPath: before } : {}),
  };
}

/** Git C-quotes paths containing control characters or quotes, even with core.quotepath=false. */
function decodeGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const escapes: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  const parts = value.slice(1, -1).match(/\\(?:[0-7]{1,3}|.)|[^\\]+/gu) ?? [];
  // Octal escapes represent bytes, so decode UTF-8 only after joining all parts.
  return Buffer.concat(parts.map((part) => {
    if (!part.startsWith('\\')) return Buffer.from(part);
    const escaped = part.slice(1);
    return /^[0-7]{1,3}$/u.test(escaped)
      ? Buffer.from([Number.parseInt(escaped, 8)])
      : Buffer.from(escapes[escaped] ?? escaped);
  })).toString('utf8');
}
