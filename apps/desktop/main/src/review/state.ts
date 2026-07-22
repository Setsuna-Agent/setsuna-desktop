import type {
  DesktopCommitMessageGenerationSource,
  DesktopDiffFile,
  DesktopDiffLine,
  DesktopDiffSummary,
  DesktopReviewActionResult,
  DesktopReviewBranch,
  DesktopReviewCommitInput,
  DesktopReviewCommitResult,
  DesktopReviewCreateBranchOptions,
  DesktopReviewPushResult,
  DesktopReviewState,
  DesktopReviewStateOptions,
} from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import { readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_DIFF_LINES_PER_FILE = 2500;
const MAX_UNTRACKED_FILE_BYTES = 512 * 1024;
const MAX_COMMIT_MESSAGE_SOURCE_CHARS = 24_000;

export async function getDesktopReviewState(workspaceRoot: string, options: DesktopReviewStateOptions = {}): Promise<DesktopReviewState> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await gitRootFor(root);
  if (!gitRoot) {
    return {
      isGitRepository: false,
      workspaceRoot: root,
      gitRoot: null,
      currentBranch: null,
      currentRemoteRef: null,
      baseRef: null,
      baseRefs: [],
      branches: [],
      currentRemoteSummary: null,
      branchSummary: null,
      stagedSummary: null,
      unstagedSummary: null,
    };
  }

  const currentBranch = await currentGitBranch(gitRoot);
  const baseRefs = await listBaseRefs(gitRoot);
  const currentRemoteRef = await resolveCurrentRemoteRef(gitRoot, baseRefs, currentBranch);
  const baseRef = resolveBaseRef(options.baseRef, baseRefs, currentBranch, currentRemoteRef);
  const status = await gitStatusPorcelain(gitRoot);
  const branches = await listBranches(gitRoot, currentBranch, dirtyFileCountFromStatus(status));
  const [branchSummary, fallbackCurrentRemoteSummary, stagedSummary, unstagedSummary] = await Promise.all([
    baseRef ? branchDiffSummary(gitRoot, baseRef) : Promise.resolve(null),
    currentRemoteRef && currentRemoteRef !== baseRef ? branchDiffSummary(gitRoot, currentRemoteRef) : Promise.resolve(null),
    diffSummary(gitRoot, ['--cached', '--']),
    unstagedDiffSummary(gitRoot),
  ]);
  const currentRemoteSummary = currentRemoteRef === baseRef ? branchSummary : fallbackCurrentRemoteSummary;

  return {
    isGitRepository: true,
    workspaceRoot: root,
    gitRoot,
    currentBranch,
    currentRemoteRef,
    baseRef,
    baseRefs,
    branches,
    currentRemoteSummary,
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

export async function checkoutReviewBranch(workspaceRoot: string, branchName: string): Promise<DesktopReviewState> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await requireGitRoot(root);
  const normalized = normalizeBranchName(branchName);
  const branches = await listBranches(gitRoot, await currentGitBranch(gitRoot), 0);
  if (!branches.some((branch) => branch.name === normalized && !branch.remote)) throw new Error('分支不存在。');
  await runGit(['checkout', normalized], gitRoot);
  return getDesktopReviewState(root);
}

export async function createAndCheckoutReviewBranch(
  workspaceRoot: string,
  branchName: string,
  options: DesktopReviewCreateBranchOptions = {},
): Promise<DesktopReviewState> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await requireGitRoot(root);
  const normalized = normalizeBranchName(branchName);
  if (!options.allowUnstaged && await hasUnstagedChanges(gitRoot)) throw new Error('请先暂存或丢弃当前工作区的未暂存更改。');
  await assertValidBranchName(gitRoot, normalized);
  await runGit(['checkout', '-b', normalized], gitRoot);
  return getDesktopReviewState(root);
}

export async function commitReviewChanges(
  workspaceRoot: string,
  input: DesktopReviewCommitInput,
): Promise<DesktopReviewCommitResult> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await requireGitRoot(root);
  const message = normalizeCommitMessage(input.message);
  if (input.includeUnstaged !== false) await runGit(['add', '--all'], gitRoot);

  const stagedFiles = await runGit(['diff', '--cached', '--name-only', '--'], gitRoot)
    .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .catch(() => []);
  if (!stagedFiles.length) throw new Error('没有可提交的暂存更改。');

  await runGit(['commit', '-m', message], gitRoot);
  const commitHash = await runGit(['rev-parse', '--short', 'HEAD'], gitRoot).catch(() => '');
  let pushed = false;
  let pushError: string | undefined;
  if (input.push) {
    try {
      await pushCurrentBranch(gitRoot);
      pushed = true;
    } catch (error) {
      // 此时提交已经持久化，因此将推送失败报告为部分失败。
      pushError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    ok: true,
    commitHash,
    pushed,
    ...(pushError ? { pushError } : {}),
    state: await getDesktopReviewState(root),
  };
}

export async function pushReviewBranch(workspaceRoot: string): Promise<DesktopReviewPushResult> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await requireGitRoot(root);
  await pushCurrentBranch(gitRoot);
  return {
    ok: true,
    pushed: true,
    state: await getDesktopReviewState(root),
  };
}

export async function getCommitMessageGenerationSource(
  workspaceRoot: string,
  includeUnstaged = true,
): Promise<DesktopCommitMessageGenerationSource> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await requireGitRoot(root);
  const [status, stagedDiff, unstagedDiff, untrackedFiles] = await Promise.all([
    gitStatusPorcelain(gitRoot),
    runGit(['diff', '--no-ext-diff', '--cached', '--unified=3', '--'], gitRoot).catch(() => ''),
    includeUnstaged ? runGit(['diff', '--no-ext-diff', '--unified=3', '--'], gitRoot).catch(() => '') : Promise.resolve(''),
    includeUnstaged
      ? runGit(['ls-files', '--others', '--exclude-standard'], gitRoot)
        .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
        .catch(() => [])
      : Promise.resolve([]),
  ]);
  const untrackedSummary = untrackedFiles.length ? `Untracked files:\n${untrackedFiles.map((file) => `- ${file}`).join('\n')}` : '';
  const diff = truncateCommitMessageSource(
    [
      stagedDiff ? `Staged diff:\n${stagedDiff}` : '',
      unstagedDiff ? `Unstaged diff:\n${unstagedDiff}` : '',
      untrackedSummary,
    ].filter(Boolean).join('\n\n'),
  );
  if (!status.trim() && !diff.trim()) throw new Error('没有可生成提交信息的更改。');
  return {
    branch: await currentGitBranch(gitRoot),
    status,
    diff,
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

async function requireGitRoot(workspaceRoot: string): Promise<string> {
  const gitRoot = await gitRootFor(workspaceRoot);
  if (!gitRoot) throw new Error('不是 Git 仓库。');
  return gitRoot;
}

async function resolveReviewAction(workspaceRoot: string, filePaths: string[]): Promise<{ root: string; gitRoot: string; files: string[] }> {
  const root = await resolveWorkspaceDirectory(workspaceRoot);
  const gitRoot = await requireGitRoot(root);
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

async function currentGitBranchName(gitRoot: string): Promise<string | null> {
  const branch = await runGit(['branch', '--show-current'], gitRoot).catch(() => '');
  return branch || null;
}

async function listBaseRefs(gitRoot: string): Promise<string[]> {
  const [localRefs, remoteRefs] = await Promise.all([
    runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], gitRoot).catch(() => ''),
    runGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], gitRoot).catch(() => ''),
  ]);
  const locals = localRefs.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const remotes = remoteRefs.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((ref) => ref && !isRemoteHeadRef(ref));
  return sortBaseRefs([...new Set([...locals, ...remotes])]);
}

function isRemoteHeadRef(ref: string): boolean {
  return ref.endsWith('/HEAD') || !ref.includes('/');
}

async function listBranches(gitRoot: string, currentBranch: string | null, uncommittedFiles: number): Promise<DesktopReviewBranch[]> {
  const localRefs = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], gitRoot).catch(() => '');
  const names = localRefs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const uniqueNames = [...new Set(currentBranch && !names.includes(currentBranch) ? [currentBranch, ...names] : names)];
  return uniqueNames
    .sort((left, right) => {
      if (left === currentBranch) return -1;
      if (right === currentBranch) return 1;
      return left.localeCompare(right);
    })
    .map((name) => ({
      name,
      current: name === currentBranch,
      remote: false,
      uncommittedFiles: name === currentBranch ? uncommittedFiles : 0,
    }));
}

function sortBaseRefs(refs: string[]): string[] {
  const priority = new Map(['origin/main', 'origin/master', 'upstream/main', 'upstream/master', 'main', 'master'].map((ref, index) => [ref, index]));
  return [...refs].sort((left, right) => {
    const leftPriority = priority.get(left);
    const rightPriority = priority.get(right);
    if (leftPriority !== undefined || rightPriority !== undefined) return (leftPriority ?? Number.MAX_SAFE_INTEGER) - (rightPriority ?? Number.MAX_SAFE_INTEGER);
    return left.localeCompare(right);
  });
}

function resolveBaseRef(
  requestedBaseRef: string | null | undefined,
  baseRefs: string[],
  currentBranch: string | null,
  currentRemoteRef: string | null,
): string | null {
  const requested = requestedBaseRef?.trim();
  if (requested && baseRefs.includes(requested)) return requested;
  if (currentRemoteRef && baseRefs.includes(currentRemoteRef)) return currentRemoteRef;
  for (const candidate of defaultBaseRefCandidates(currentBranch)) {
    if (baseRefs.includes(candidate)) return candidate;
  }
  return baseRefs[0] ?? null;
}

async function resolveCurrentRemoteRef(gitRoot: string, baseRefs: string[], currentBranch: string | null): Promise<string | null> {
  const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], gitRoot).catch(() => '');
  if (upstream && baseRefs.includes(upstream)) return upstream;
  if (!currentBranch) return null;
  for (const candidate of [`origin/${currentBranch}`, `upstream/${currentBranch}`]) {
    if (baseRefs.includes(candidate)) return candidate;
  }
  return null;
}

function defaultBaseRefCandidates(currentBranch: string | null): string[] {
  if (currentBranch === 'master') return ['origin/master', 'upstream/master', 'master', 'origin/main', 'upstream/main', 'main'];
  if (currentBranch === 'main') return ['origin/main', 'upstream/main', 'main', 'origin/master', 'upstream/master', 'master'];
  return ['origin/main', 'origin/master', 'upstream/main', 'upstream/master', 'main', 'master'];
}

async function branchDiffSummary(gitRoot: string, baseRef: string): Promise<DesktopDiffSummary> {
  const mergeBase = await runGit(['merge-base', baseRef, 'HEAD'], gitRoot).catch(() => baseRef);
  const [tracked, untracked] = await Promise.all([
    diffSummary(gitRoot, [mergeBase, '--']),
    untrackedDiffSummary(gitRoot),
  ]);
  return mergeDiffSummaries(tracked, untracked);
}

async function gitStatusPorcelain(gitRoot: string): Promise<string> {
  return runGit(['status', '--short', '--untracked-files=all'], gitRoot).catch(() => '');
}

async function hasUnstagedChanges(gitRoot: string): Promise<boolean> {
  const [trackedHasChanges, untrackedFiles] = await Promise.all([
    runGit(['diff', '--quiet', '--'], gitRoot)
      .then(() => false)
      .catch(() => true),
    runGit(['ls-files', '--others', '--exclude-standard'], gitRoot).catch(() => ''),
  ]);
  return trackedHasChanges || Boolean(untrackedFiles.trim());
}

function dirtyFileCountFromStatus(status: string): number {
  const paths = new Set<string>();
  for (const line of status.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    paths.add(normalizeStatusPath(rawPath));
  }
  return paths.size;
}

function normalizeStatusPath(value: string): string {
  const renameArrow = ' -> ';
  return value.includes(renameArrow) ? value.slice(value.lastIndexOf(renameArrow) + renameArrow.length).trim() : value;
}

function normalizeBranchName(value: string): string {
  const branchName = value.trim();
  if (!branchName) throw new Error('分支名称不能为空。');
  if (branchName.startsWith('-')) throw new Error('分支名称无效。');
  return branchName;
}

async function assertValidBranchName(gitRoot: string, branchName: string): Promise<void> {
  await runGit(['check-ref-format', '--branch', branchName], gitRoot).catch(() => {
    throw new Error('分支名称无效。');
  });
}

function normalizeCommitMessage(value: string | null | undefined): string {
  const message = stripInvisibleCommitMessageChars(String(value ?? '')).replace(/\r\n?/g, '\n').trim();
  if (!message) throw new Error('提交信息不能为空。');
  return message;
}

function stripInvisibleCommitMessageChars(value: string): string {
  // eslint-disable-next-line no-control-regex -- 提交消息可能包含从模型输出复制的隐藏控制字符。
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '');
}

async function pushCurrentBranch(gitRoot: string): Promise<void> {
  const branch = await currentGitBranchName(gitRoot);
  if (!branch) throw new Error('当前不是可推送的本地分支。');
  const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], gitRoot).catch(() => '');
  if (upstream) {
    await runGit(['push'], gitRoot);
    return;
  }
  const remotes = await runGit(['remote'], gitRoot)
    .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .catch((): string[] => []);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  if (!remote) throw new Error('没有可推送的远端。');
  await runGit(['push', '-u', remote, branch], gitRoot);
}

function truncateCommitMessageSource(value: string): string {
  if (value.length <= MAX_COMMIT_MESSAGE_SOURCE_CHARS) return value;
  return `${value.slice(0, MAX_COMMIT_MESSAGE_SOURCE_CHARS)}\n\n[diff truncated]`;
}

async function unstagedDiffSummary(gitRoot: string): Promise<DesktopDiffSummary> {
  const [tracked, untrackedFiles] = await Promise.all([
    diffSummary(gitRoot, ['--']),
    runGit(['ls-files', '--others', '--exclude-standard'], gitRoot)
      .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
      .catch(() => []),
  ]);
  const untracked = await Promise.all(untrackedFiles.map((filePath) => summarizeUntrackedFile(gitRoot, filePath)));
  return mergeDiffSummaries(tracked, untrackedSummary(untracked));
}

async function untrackedDiffSummary(gitRoot: string): Promise<DesktopDiffSummary> {
  const untrackedFiles = await runGit(['ls-files', '--others', '--exclude-standard'], gitRoot)
    .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .catch(() => []);
  const untracked = await Promise.all(untrackedFiles.map((filePath) => summarizeUntrackedFile(gitRoot, filePath)));
  return untrackedSummary(untracked);
}

function untrackedSummary(files: Array<DesktopDiffFile | null>): DesktopDiffSummary {
  return {
    files: files.filter((file): file is DesktopDiffFile => Boolean(file)),
    additions: files.reduce((total, file) => total + (file?.additions ?? 0), 0),
    deletions: 0,
  };
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

  if (current) files.push(current);
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
