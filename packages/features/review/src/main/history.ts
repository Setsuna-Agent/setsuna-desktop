import path from 'node:path';
import type {
  DesktopDiffFile,
  DesktopGitCommit,
  DesktopGitCommitDetails,
  DesktopGitCommitFileInput,
  DesktopGitHistoryOptions,
  DesktopGitHistoryPage,
} from '../contracts/index.js';
import { parseUnifiedDiff } from './diff-parser.js';
import { resolveGitCommit, runGit, runGitRaw } from './git-command.js';
import { githubCommitUrl } from './git-commit-url.js';
import { GIT_HISTORY_FORMAT, parseGitChangedFiles, parseGitHistory, parseGitRefs } from './history-parser.js';
import { classifyReviewImages } from './image-classification.js';
import { resolveDesktopReviewRepository } from './state.js';

export async function getDesktopGitHistory(
  workspaceRoot: string,
  options: DesktopGitHistoryOptions = {},
): Promise<DesktopGitHistoryPage> {
  const { gitRoot } = await resolveDesktopReviewRepository(workspaceRoot);
  const empty: DesktopGitHistoryPage = { gitRoot, head: null, currentBranch: null, refs: [], tip: null, commits: [], nextSkip: null };
  if (!gitRoot) return empty;
  const skip = boundedInteger(options.skip, 0, 0, 1_000_000);
  const limit = boundedInteger(options.limit, 100, 1, 200);
  const [head, currentBranch, refsOutput] = await Promise.all([
    resolveGitCommit(gitRoot, 'HEAD').catch(() => null),
    runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], gitRoot).catch(() => null),
    runGitRaw(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(*objecttype)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags'], gitRoot),
  ]);
  const refs = parseGitRefs(refsOutput);
  const tip = options.ref ? await resolveGitCommit(gitRoot, options.ref) : head;
  if (!tip) return { ...empty, currentBranch, refs };
  const output = await runGitRaw([
    'log', '--topo-order', '--max-count=' + (limit + 1), '--skip=' + skip,
    '--format=' + GIT_HISTORY_FORMAT, tip, '--',
  ], gitRoot);
  const commits = parseGitHistory(output);
  return {
    gitRoot, head, currentBranch, refs, tip,
    commits: commits.slice(0, limit),
    nextSkip: commits.length > limit ? skip + limit : null,
  };
}

export async function getDesktopGitCommitDetails(workspaceRoot: string, oid: string): Promise<DesktopGitCommitDetails> {
  const { gitRoot } = await resolveDesktopReviewRepository(workspaceRoot);
  if (!gitRoot) throw new Error('The workspace is not a Git repository.');
  const commit = await readCommit(gitRoot, oid);
  const [statuses, stats, message, remote] = await Promise.all([
    runGitRaw(commitDiffArgs(commit, ['--name-status', '-z']), gitRoot),
    runGitRaw(commitDiffArgs(commit, ['--numstat', '-z']), gitRoot),
    runGit(['show', '--no-patch', '--format=%B', commit.oid, '--'], gitRoot),
    runGit(['remote', 'get-url', 'origin'], gitRoot).catch(() => ''),
  ]);
  return { commit, message, githubUrl: githubCommitUrl(remote, commit.oid), baseOid: commit.parents[0] ?? null, files: parseGitChangedFiles(statuses, stats) };
}

export async function getDesktopGitCommitFileDiff(
  workspaceRoot: string,
  input: DesktopGitCommitFileInput,
): Promise<DesktopDiffFile> {
  const { gitRoot } = await resolveDesktopReviewRepository(workspaceRoot);
  if (!gitRoot) throw new Error('The workspace is not a Git repository.');
  const filePath = repositoryPath(gitRoot, input.filePath);
  const previousPath = input.previousPath === undefined ? undefined : repositoryPath(gitRoot, input.previousPath);
  const commit = await readCommit(gitRoot, input.oid);
  const args = commitDiffArgs(commit, ['--patch', '--unified=6']);
  // Literal pathspecs disable patterns but can still include descendants of a replaced file.
  args.push(...[...new Set([previousPath, filePath].filter((value): value is string => Boolean(value)))].map((value) => ':(literal)' + value));
  const summary = parseUnifiedDiff(await runGitRaw(args, gitRoot));
  const matchingFiles = summary.files.filter((entry) => entry.path === filePath && (!previousPath || entry.previousPath === previousPath));
  if (matchingFiles.length !== 1) throw new Error('The selected file is not a single change in this commit.');
  const file = matchingFiles[0];
  await classifyReviewImages(gitRoot, { files: [file], additions: file.additions, deletions: file.deletions }, {
    before: { kind: 'git', revision: commit.parents[0] ?? commit.oid },
    after: { kind: 'git', revision: commit.oid },
  });
  return file;
}

function commitDiffArgs(commit: DesktopGitCommit, flags: string[]): string[] {
  const shared = ['--no-ext-diff', '--no-textconv', '--find-renames', ...flags];
  // Explicitly select the first parent: Git's default merge diff can be empty.
  return commit.parents[0]
    ? ['diff', ...shared, commit.parents[0], commit.oid, '--']
    : ['diff-tree', '--no-commit-id', '--root', '-r', ...shared, commit.oid, '--'];
}

async function readCommit(gitRoot: string, oid: string): Promise<DesktopGitCommit> {
  if (typeof oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(oid)) throw new Error('Invalid commit ID.');
  const resolved = await resolveGitCommit(gitRoot, oid);
  const output = await runGitRaw(['show', '--no-patch', '--format=' + GIT_HISTORY_FORMAT, resolved, '--'], gitRoot);
  const commit = parseGitHistory(output)[0];
  if (!commit) throw new Error('Commit is unavailable.');
  return commit;
}

function repositoryPath(gitRoot: string, value: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) throw new Error('Invalid repository file path.');
  const relative = path.relative(gitRoot, path.resolve(gitRoot, value));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('File path must stay inside the repository.');
  return relative.split(path.sep).join('/');
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid history page.');
  return value;
}
