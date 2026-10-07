import type { DesktopReviewFileVersionInput } from '../contracts/index.js';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { resolveGitCommit } from './git-command.js';
import { resolveDesktopReviewRepository } from './state.js';

export async function readReviewGitFile(workspaceRoot: string, input: DesktopReviewFileVersionInput, maxBytes: number): Promise<Buffer> {
  const repository = await resolveDesktopReviewRepository(workspaceRoot);
  if (!repository.gitRoot) throw new Error('The workspace is not a Git repository.');
  const repositoryPath = resolveRepositoryPath(repository.workspaceRoot, repository.gitRoot, input.filePath);
  const revision = await reviewFileRevision(repository.gitRoot, input);
  if (revision === null) throw new Error('This file version is unavailable.');
  return readGitBlob(repository.gitRoot, revision + ':' + repositoryPath, maxBytes);
}

export function normalizeReviewFileVersionInput(value: unknown): DesktopReviewFileVersionInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : '';
  const side = input.side;
  const source = input.source;
  if (!filePath || (side !== 'before' && side !== 'after')) return null;
  if (source !== 'unstaged' && source !== 'staged' && source !== 'branch' && source !== 'latest' && source !== 'commit') return null;
  let revisions: DesktopReviewFileVersionInput['revisions'];
  if (input.revisions !== undefined) {
    if (!input.revisions || typeof input.revisions !== 'object') return null;
    const pair = input.revisions as Record<string, unknown>;
    const isOid = (candidate: unknown): candidate is string => typeof candidate === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(candidate);
    if (!isOid(pair.after) || (pair.before !== null && !isOid(pair.before))) return null;
    revisions = { before: pair.before, after: pair.after };
  }
  if ((source === 'commit') !== Boolean(revisions)) return null;
  return {
    filePath,
    side,
    source,
    baseRef: typeof input.baseRef === 'string' ? input.baseRef : null,
    ...(revisions ? { revisions } : {}),
  };
}

export function reviewFileVersion(input: DesktopReviewFileVersionInput): 'workspace' | 'index' | 'head' | 'merge-base' | null {
  if (input.side === 'after') {
    return input.source === 'staged' ? 'index' : 'workspace';
  }
  if (input.source === 'unstaged') return 'index';
  if (input.source === 'staged') return 'head';
  if (input.source === 'branch') return 'merge-base';
  return null;
}

async function reviewFileRevision(
  gitRoot: string,
  input: DesktopReviewFileVersionInput,
): Promise<string | null> {
  if (input.revisions) {
    const oid = input.revisions[input.side];
    return oid ? resolveGitCommit(gitRoot, oid) : null;
  }
  const version = reviewFileVersion(input);
  if (version === 'index') return '';
  if (version === 'head') return 'HEAD';
  if (version !== 'merge-base') return null;
  const baseRef = input.baseRef?.trim() ?? '';
  if (!baseRef || baseRef.startsWith('-') || /[\0\r\n]/u.test(baseRef)) return null;
  return runGitText(gitRoot, ['merge-base', baseRef, 'HEAD']).catch(() => baseRef);
}

function resolveRepositoryPath(workspaceRoot: string, gitRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) throw new Error('File path must be relative to the workspace.');
  const absolutePath = path.resolve(workspaceRoot, filePath);
  const workspaceRelativePath = path.relative(workspaceRoot, absolutePath);
  if (!workspaceRelativePath || pathEscapesRoot(workspaceRelativePath)) {
    throw new Error('File path must stay inside the workspace.');
  }
  const repositoryPath = path.relative(gitRoot, absolutePath);
  if (!repositoryPath || pathEscapesRoot(repositoryPath)) {
    throw new Error('File path must stay inside the Git repository.');
  }
  return repositoryPath.split(path.sep).join('/');
}

function pathEscapesRoot(relativePath: string): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

function readGitBlob(gitRoot: string, objectSpec: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', 'cat-file', 'blob', objectSpec],
      {
        cwd: gitRoot,
        encoding: null,
        maxBuffer: maxBytes,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error('This file version is unavailable or too large.'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function runGitText(gitRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd: gitRoot, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}
