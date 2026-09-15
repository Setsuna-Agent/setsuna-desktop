import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PullRequestFile, PullRequestFilesInput, PullRequestPatch } from '../contracts/index.js';
import { GitHubApi, repoPath, type GitHubTransport } from './github-api.js';
import { git } from './git.js';

type GitSnapshot = { cwd: string; base: string; head: string };
export async function loadGitSnapshot(api: GitHubApi, connection: GitHubTransport, cwd: string, input: PullRequestFilesInput, signal?: AbortSignal): Promise<GitSnapshot> {
  const { value } = await api.request<{ merge_base_commit: { sha: string } }>(`${repoPath(input.repository)}/compare/${input.baseSha}...${input.headSha}`, { signal });
  const base = value.merge_base_commit.sha;
  if (!/^[a-f0-9]{40,64}$/u.test(base)) throw new Error('GitHub returned an invalid merge base.');
  const environment = await connection.gitEnvironment();
  for (const sha of [base, input.headSha]) {
    try { await git(cwd, ['cat-file', '-e', `${sha}^{commit}`], signal); } catch {
      signal?.throwIfAborted();
      // Fetch objects only: no checkout, index changes, branch updates or FETCH_HEAD writes.
      await git(cwd, ['-c', 'fetch.recurseSubmodules=false', '-c', 'maintenance.auto=false', 'fetch', '--no-tags', '--no-write-fetch-head', `https://github.com/${input.repository}.git`, sha], signal, environment);
    }
  }
  return { cwd, base, head: input.headSha };
}

/** NUL-delimited fields preserve tabs/newlines and renamed paths on both supported platforms. */
export function parseGitFileList(status: string, stats: string): PullRequestFile[] {
  const files = new Map<string, PullRequestFile>();
  const records = status.split('\0');
  for (let index = 0; index < records.length - 1;) {
    const action = records[index++];
    const first = records[index++];
    if (!action || first === undefined) break;
    const renamed = /^[RC]/u.test(action);
    const path = renamed ? records[index++] : first;
    files.set(path, { path, previousPath: renamed ? first : null, status: action.startsWith('R') ? 'renamed' : action.startsWith('C') ? 'copied' : action === 'A' ? 'added' : action === 'D' ? 'removed' : 'modified', additions: 0, deletions: 0 });
  }
  const counts = stats.split('\0');
  for (let index = 0; index < counts.length - 1;) {
    const row = counts[index++];
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/u.exec(row);
    if (!match) continue;
    let path = match[3];
    if (!path) { index += 1; path = counts[index++]; }
    const file = files.get(path);
    if (file) { file.additions = Number(match[1]) || 0; file.deletions = Number(match[2]) || 0; }
  }
  return [...files.values()];
}
const diffArguments = (snapshot: GitSnapshot) => ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--find-renames', snapshot.base, snapshot.head];
export async function gitFiles(snapshot: GitSnapshot, signal?: AbortSignal): Promise<PullRequestFile[]> {
  const [status, stats] = await Promise.all([
    git(snapshot.cwd, [...diffArguments(snapshot), '--name-status', '-z', '--'], signal),
    git(snapshot.cwd, [...diffArguments(snapshot), '--numstat', '-z', '--'], signal),
  ]);
  return parseGitFileList(status, stats);
}
export async function gitPatch(snapshot: GitSnapshot, file: PullRequestFile, signal?: AbortSignal): Promise<PullRequestPatch> {
  const output = await git(snapshot.cwd, [...diffArguments(snapshot), '--patch', '--full-index', '--no-color', '--unified=6', '--src-prefix=a/', '--dst-prefix=b/', '--no-relative', '--', file.path, ...(file.previousPath ? [file.previousPath] : [])], signal);
  const patch = await selectFilePatch(output, file, snapshot.cwd, signal);
  if (isBinaryPatch(patch)) return { patch: null, kind: 'binary' };
  return { patch: patch || null, kind: patch ? 'text' : 'empty' };
}

/** Git still C-quotes controls, quotes and backslashes with core.quotePath=false. */
function quotePatchPath(path: string): string {
  const escapes: Record<string, string> = { '\x07': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\v': '\\v', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' };
  let quoted = '';
  for (const char of path) {
    const code = char.charCodeAt(0);
    quoted += escapes[char] ?? (code < 32 || code === 127 ? `\\${code.toString(8).padStart(3, '0')}` : char);
  }
  return quoted === path ? path : `"${quoted}"`;
}

const isBinaryPatch = (patch: string) => /^Binary files .* differ$/mu.test(patch) || /^GIT binary patch$/mu.test(patch);

async function selectFilePatch(output: string, file: PullRequestFile, cwd: string, signal?: AbortSignal): Promise<string> {
  if (!output) return '';
  // A literal pathspec also matches the old/new directory's descendants. Compare
  // full Git headers rather than prefixes, keeping the original hunk text intact.
  const header = `diff --git ${quotePatchPath(`a/${file.previousPath ?? file.path}`)} ${quotePatchPath(`b/${file.path}`)}\n`;
  const matches = output.split(/(?=^diff --git )/mu).filter((patch) => patch.startsWith(header));
  if (matches.length === 1) return matches[0];
  if (matches.length === 2 && !file.previousPath) {
    const removed = matches.map((patch) => /^deleted file mode (100644|100755|120000)\nindex ([a-f0-9]{40,64})\.\.0+$/mu.exec(patch)).find(Boolean);
    const added = matches.map((patch) => /^new file mode (100644|100755|120000)\nindex 0+\.\.([a-f0-9]{40,64})$/mu.exec(patch)).find(Boolean);
    if (removed && added && removed[1] !== added[1]) {
      if (matches.some(isBinaryPatch)) return matches.join('');
      // A file/symlink replacement is two path-level patches. Diff the immutable
      // blobs to get one set of hunks without dereferencing a worktree symlink.
      const content = await git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=6', removed[2], added[2], '--'], signal);
      const hunkStart = content.search(/^@@ /mu);
      const modes = `${header}old mode ${removed[1]}\nnew mode ${added[1]}\nindex ${removed[2]}..${added[2]}\n`;
      if (isBinaryPatch(content)) return content;
      if (hunkStart < 0) return modes;
      return `${modes}--- ${quotePatchPath(`a/${file.path}`)}\n+++ ${quotePatchPath(`b/${file.path}`)}\n${content.slice(hunkStart)}`;
    }
  }
  throw new FeatureOperationFailure({ code: 'PR_GIT_FAILED', message: 'Could not isolate the selected file diff.', retryable: false });
}
