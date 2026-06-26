import { execFile } from 'node:child_process';
import { readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed';
  lineNumber: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DesktopDiffFile = {
  path: string;
  action: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: DesktopDiffLine[];
};

export type DesktopDiffSummary = {
  files: DesktopDiffFile[];
  additions: number;
  deletions: number;
};

export type DesktopReviewState = {
  isGitRepository: boolean;
  workspaceRoot: string;
  gitRoot: string | null;
  currentBranch: string | null;
  baseRef: string | null;
  branchSummary: DesktopDiffSummary | null;
  stagedSummary: DesktopDiffSummary | null;
  unstagedSummary: DesktopDiffSummary | null;
};

export type DesktopReviewActionResult = {
  ok: true;
  files: string[];
  state: DesktopReviewState;
};

const MAX_DIFF_LINES_PER_FILE = 2500;
const MAX_UNTRACKED_FILE_BYTES = 512 * 1024;

export async function getDesktopReviewState(workspaceRoot: string): Promise<DesktopReviewState> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await gitRootFor(root);
  if (!gitRoot) {
    return {
      isGitRepository: false,
      workspaceRoot: root,
      gitRoot: null,
      currentBranch: null,
      baseRef: null,
      branchSummary: null,
      stagedSummary: null,
      unstagedSummary: null,
    };
  }

  const currentBranch = await currentGitBranch(gitRoot);
  const baseRef = await resolveBaseRef(gitRoot);
  const [branchSummary, stagedSummary, unstagedSummary] = await Promise.all([
    baseRef ? diffSummary(gitRoot, [baseRef, 'HEAD', '--']) : Promise.resolve(null),
    diffSummary(gitRoot, ['--cached', '--']),
    unstagedDiffSummary(gitRoot),
  ]);

  return {
    isGitRepository: true,
    workspaceRoot: root,
    gitRoot,
    currentBranch,
    baseRef,
    branchSummary,
    stagedSummary,
    unstagedSummary,
  };
}

export async function stageReviewFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult> {
  const { root, gitRoot, files } = await resolveReviewAction(workspaceRoot, filePaths);
  await runGit(['add', '--', ...files], gitRoot);
  return {
    ok: true,
    files,
    state: await getDesktopReviewState(root),
  };
}

export async function unstageReviewFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult> {
  const { root, gitRoot, files } = await resolveReviewAction(workspaceRoot, filePaths);
  await runGit(['reset', '--', ...files], gitRoot);
  return {
    ok: true,
    files,
    state: await getDesktopReviewState(root),
  };
}

export async function discardUnstagedReviewFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult> {
  const { root, gitRoot, files } = await resolveReviewAction(workspaceRoot, filePaths);
  const untracked = new Set(
    (
      await runGit(['ls-files', '--others', '--exclude-standard', '--', ...files], gitRoot).catch(() => '')
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const tracked = files.filter((filePath) => !untracked.has(filePath));
  if (tracked.length) await runGit(['restore', '--worktree', '--', ...tracked], gitRoot);
  await Promise.all(
    files
      .filter((filePath) => untracked.has(filePath))
      .map((filePath) => rm(path.resolve(gitRoot, filePath), { force: true, recursive: false })),
  );

  return {
    ok: true,
    files,
    state: await getDesktopReviewState(root),
  };
}

async function resolveWorkspaceDirectory(value: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请先选择项目目录。');
  const resolved = await realpath(path.resolve(trimmed));
  const workspaceStat = await stat(resolved);
  if (!workspaceStat.isDirectory()) throw new Error('项目目录不存在。');
  return resolved;
}

async function gitRootFor(workspaceRoot: string): Promise<string | null> {
  return runGit(['rev-parse', '--show-toplevel'], workspaceRoot).catch(() => null);
}

async function resolveReviewAction(workspaceRoot: string, filePaths: string[]): Promise<{ root: string; gitRoot: string; files: string[] }> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await gitRootFor(root);
  if (!gitRoot) throw new Error('不是 Git 仓库。');
  const files = normalizeReviewFilePaths(gitRoot, filePaths);
  if (!files.length) throw new Error('没有选择文件。');
  return { root, gitRoot, files };
}

function normalizeReviewFilePaths(gitRoot: string, filePaths: string[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const rawPath of filePaths) {
    const normalized = normalizeReviewFilePath(gitRoot, rawPath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      files.push(normalized);
    }
  }
  return files;
}

function normalizeReviewFilePath(gitRoot: string, filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) throw new Error('文件路径为空。');
  if (path.isAbsolute(trimmed)) throw new Error('文件路径必须在项目内。');
  const absolutePath = path.resolve(gitRoot, trimmed);
  const relative = path.relative(gitRoot, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件路径必须在项目内。');
  return relative.split(path.sep).join('/');
}

async function currentGitBranch(gitRoot: string): Promise<string | null> {
  const branch = await runGit(['branch', '--show-current'], gitRoot).catch(() => '');
  if (branch) return branch;
  return runGit(['rev-parse', '--short', 'HEAD'], gitRoot).catch(() => null);
}

async function resolveBaseRef(gitRoot: string): Promise<string | null> {
  const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], gitRoot).catch(() => '');
  if (upstream) return upstream;
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const exists = await runGit(['rev-parse', '--verify', candidate], gitRoot).then(() => true).catch(() => false);
    if (exists) return candidate;
  }
  return null;
}

async function unstagedDiffSummary(gitRoot: string): Promise<DesktopDiffSummary> {
  const [tracked, untrackedFiles] = await Promise.all([
    diffSummary(gitRoot, ['--']),
    runGit(['ls-files', '--others', '--exclude-standard'], gitRoot)
      .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
      .catch(() => []),
  ]);
  const untracked = await Promise.all(untrackedFiles.map((filePath) => summarizeUntrackedFile(gitRoot, filePath)));
  return mergeDiffSummaries(tracked, {
    files: untracked.filter((file): file is DesktopDiffFile => Boolean(file)),
    additions: untracked.reduce((total, file) => total + (file?.additions ?? 0), 0),
    deletions: 0,
  });
}

async function diffSummary(gitRoot: string, diffArgs: string[]): Promise<DesktopDiffSummary> {
  const output = await runGit(['diff', '--no-ext-diff', '--unified=3', ...diffArgs], gitRoot).catch(() => '');
  return parseUnifiedDiff(output);
}

function parseUnifiedDiff(output: string): DesktopDiffSummary {
  const files: DesktopDiffFile[] = [];
  let current: DesktopDiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let truncated = false;

  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      if (current) files.push(current);
      current = {
        path: parseDiffPath(rawLine),
        action: 'Modified',
        additions: 0,
        deletions: 0,
        truncated: false,
        lines: [],
      };
      oldLine = 0;
      newLine = 0;
      truncated = false;
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith('new file mode')) current.action = 'Created';
    if (rawLine.startsWith('deleted file mode')) current.action = 'Deleted';
    if (rawLine.startsWith('rename from ')) current.action = 'Renamed';
    if (rawLine.startsWith('+++ b/')) current.path = rawLine.slice(6);
    if (rawLine.startsWith('@@ ')) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      pushDiffLine(current, {
        type: 'context',
        lineNumber: current.lines.length + 1,
        oldLine,
        newLine,
        content: rawLine,
      }, truncated);
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

  if (current) files.push(current);
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

function pushDiffLine(file: DesktopDiffFile, line: DesktopDiffLine, alreadyTruncated: boolean): void {
  if (alreadyTruncated || file.lines.length >= MAX_DIFF_LINES_PER_FILE) {
    file.truncated = true;
    return;
  }
  file.lines.push(line);
}

async function summarizeUntrackedFile(gitRoot: string, relativePath: string): Promise<DesktopDiffFile | null> {
  const absolutePath = path.resolve(gitRoot, relativePath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) return null;
  if (fileStat.size > MAX_UNTRACKED_FILE_BYTES) {
    return {
      path: relativePath,
      action: 'Created',
      additions: 0,
      deletions: 0,
      truncated: true,
      lines: [],
    };
  }
  const content = await readFile(absolutePath, 'utf8').catch(() => '');
  const lines = content.split(/\r?\n/);
  return {
    path: relativePath,
    action: 'Created',
    additions: content ? lines.length : 0,
    deletions: 0,
    truncated: lines.length > MAX_DIFF_LINES_PER_FILE,
    lines: lines.slice(0, MAX_DIFF_LINES_PER_FILE).map((line, index) => ({
      type: 'added',
      lineNumber: index + 1,
      newLine: index + 1,
      content: line,
    })),
  };
}

function mergeDiffSummaries(left: DesktopDiffSummary, right: DesktopDiffSummary): DesktopDiffSummary {
  return {
    files: [...left.files, ...right.files],
    additions: left.additions + right.additions,
    deletions: left.deletions + right.deletions,
  };
}

function parseDiffPath(line: string): string {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  return match?.[2] ?? line.replace(/^diff --git /, '');
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}
