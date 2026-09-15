import type { PullRequestFile, PullRequestFilesInput, PullRequestPatchInput, PullRequestPatch } from '../contracts/index.js';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { GitHubApi, repoPath, requestChanged } from './github-api.js';
import { gitFiles, gitPatch, loadGitSnapshot } from './git-diff.js';

type ApiFile = { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string };
type Snapshot = {
  files: Map<string, PullRequestFile>; patches: Map<string, string>; patchBytes: number;
  git?: Awaited<ReturnType<typeof loadGitSnapshot>>; gitFiles?: PullRequestFile[];
};
export function completePatch(file: ApiFile): string | null {
  if (!file.patch?.trim()) return null;
  let additions = 0;
  let deletions = 0;
  for (const line of file.patch.split('\n')) {
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  }
  if (additions !== file.additions || deletions !== file.deletions) return null;
  // Quoting prevents a filename from manufacturing patch headers.
  const oldPath = JSON.stringify(`a/${file.previous_filename ?? file.filename}`);
  const newPath = JSON.stringify(`b/${file.filename}`);
  return [`diff --git ${oldPath} ${newPath}`,
    ...(file.status === 'added' ? ['new file mode 100644'] : file.status === 'removed' ? ['deleted file mode 100644'] : []),
    `--- ${file.status === 'added' ? '/dev/null' : oldPath}`, `+++ ${file.status === 'removed' ? '/dev/null' : newPath}`, file.patch,
  ].join('\n');
}

export class PullRequestFiles {
  private readonly snapshots = new Map<string, Snapshot>();
  constructor(private readonly api: GitHubApi) {}

  clear(): void { this.snapshots.clear(); }

  async list(input: PullRequestFilesInput, cwd: string, signal?: AbortSignal) {
    const total = await this.assertCurrent(input, signal);
    const snapshot = this.snapshot(input);
    if (total > 3000 || snapshot.gitFiles) return this.localFiles(input, snapshot, cwd, signal);
    const { value, more } = await this.api.request<ApiFile[]>(`${repoPath(input.repository)}/pulls/${input.number}/files?per_page=100&page=${input.page}`, { signal });
    await this.assertCurrent(input, signal);
    const files = value.map((file) => {
      const item = { path: file.filename, previousPath: file.previous_filename ?? null, status: file.status, additions: file.additions, deletions: file.deletions };
      snapshot.files.set(item.path, item);
      const patch = completePatch(file);
      if (patch && !snapshot.patches.has(item.path) && snapshot.patchBytes + patch.length <= 8_000_000) {
        snapshot.patches.set(item.path, patch);
        snapshot.patchBytes += patch.length;
      }
      return item;
    });
    if (!more && (input.page - 1) * 100 + files.length < total) return { ...await this.localFiles({ ...input, page: 1 }, snapshot, cwd, signal), reset: true };
    return { files, total, nextPage: more ? input.page + 1 : null, reset: false };
  }

  async patch(input: PullRequestPatchInput, cwd: string, signal?: AbortSignal): Promise<PullRequestPatch> {
    await this.assertCurrent(input, signal);
    const snapshot = this.snapshot(input);
    let file = snapshot.files.get(input.path);
    if (!file) {
      // A resumed renderer can request a file before its process-local cache is rebuilt.
      let page: number | null = 1;
      while (page && !file) {
        const result = await this.list({ ...input, page }, cwd, signal);
        page = result.nextPage;
        file = snapshot.files.get(input.path);
      }
    }
    if (!file) throw new FeatureOperationFailure({ code: 'PR_NOT_FOUND', message: 'This file is not part of the selected PR revision.', retryable: false });
    const patch = snapshot.patches.get(input.path);
    if (patch) return { patch, kind: 'text' };
    const git = snapshot.git ??= await loadGitSnapshot(this.api, this.api.connection, cwd, { ...input, page: 1 }, signal);
    const result = await gitPatch(git, file, signal);
    await this.assertCurrent(input, signal);
    return result;
  }

  private async localFiles(input: PullRequestFilesInput, snapshot: Snapshot, cwd: string, signal?: AbortSignal) {
    snapshot.git ??= await loadGitSnapshot(this.api, this.api.connection, cwd, input, signal);
    snapshot.gitFiles ??= await gitFiles(snapshot.git, signal);
    await this.assertCurrent(input, signal);
    for (const file of snapshot.gitFiles) snapshot.files.set(file.path, file);
    const start = (input.page - 1) * 100;
    return { files: snapshot.gitFiles.slice(start, start + 100), total: snapshot.gitFiles.length, nextPage: start + 100 < snapshot.gitFiles.length ? input.page + 1 : null, reset: false };
  }

  private snapshot(input: Pick<PullRequestFilesInput, 'repository' | 'number' | 'baseSha' | 'headSha'>): Snapshot {
    const key = `${input.repository}:${input.number}:${input.baseSha}:${input.headSha}`;
    let snapshot = this.snapshots.get(key);
    if (!snapshot) {
      snapshot = { files: new Map(), patches: new Map(), patchBytes: 0 };
      this.snapshots.set(key, snapshot);
      if (this.snapshots.size > 3) this.snapshots.delete(this.snapshots.keys().next().value!);
    }
    return snapshot;
  }

  private async assertCurrent(input: Pick<PullRequestFilesInput, 'repository' | 'number' | 'baseSha' | 'headSha'>, signal?: AbortSignal): Promise<number> {
    const { value } = await this.api.request<{ head: { sha: string }; base: { sha: string }; changed_files: number }>(`${repoPath(input.repository)}/pulls/${input.number}`, { signal });
    if (value.head.sha !== input.headSha || value.base.sha !== input.baseSha) requestChanged();
    return value.changed_files;
  }
}
