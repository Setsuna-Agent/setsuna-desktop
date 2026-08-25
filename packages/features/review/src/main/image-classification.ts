import {
  detectWorkspacePreviewImageMimeType,
} from '@setsuna-desktop/contracts';
import type { DesktopDiffFile, DesktopDiffSummary } from '../contracts/index.js';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const REVIEW_FILE_KIND_SAMPLE_BYTES = 64 * 1024;
const REVIEW_FILE_OPEN_FLAGS = fsConstants.O_RDONLY
  | fsConstants.O_NONBLOCK
  | (fsConstants.O_NOFOLLOW ?? 0);

export type ReviewDiffFileSource =
  | { kind: 'git'; revision: string }
  | { kind: 'index' }
  | { kind: 'workspace' };

export type ReviewDiffVersionContext = {
  before: ReviewDiffFileSource;
  after: ReviewDiffFileSource;
};

export type ResolvedReviewWorkspaceFile = {
  size: number;
  targetPath: string;
};

export async function classifyReviewImages(
  gitRoot: string,
  summary: DesktopDiffSummary,
  versions: ReviewDiffVersionContext,
): Promise<void> {
  await Promise.all(summary.files.map(async (file) => {
    // Git omits the binary marker for pure renames and text-based image formats
    // such as SVG, so validate those candidates against the actual objects too.
    if (!isReviewImageCandidate(file)) return;
    const candidates: Array<{ filePath: string; source: ReviewDiffFileSource }> = [];
    if (file.action !== 'Created') {
      candidates.push({
        filePath: file.previousPath ?? file.path,
        source: versions.before,
      });
    }
    if (file.action !== 'Deleted') {
      candidates.push({ filePath: file.path, source: versions.after });
    }
    for (const candidate of candidates) {
      const sample = await readReviewVersionSample(gitRoot, candidate.source, candidate.filePath);
      if (!sample || !detectWorkspacePreviewImageMimeType(sample)) continue;
      file.contentKind = 'image';
      file.lines = [];
      file.truncated = false;
      delete file.patch;
      return;
    }
  }));
}

function isReviewImageCandidate(file: DesktopDiffFile): boolean {
  if (file.contentKind === 'binary' || file.action === 'Renamed') return true;
  return [file.path, file.previousPath].some((filePath) => (
    filePath ? path.extname(filePath).toLowerCase() === '.svg' : false
  ));
}

export async function resolveReviewWorkspaceFile(
  gitRoot: string,
  filePath: string,
): Promise<ResolvedReviewWorkspaceFile | null> {
  try {
    const relativePath = normalizeReviewFilePath(gitRoot, filePath);
    const canonicalRoot = await realpath(gitRoot);
    const lexicalTarget = path.resolve(canonicalRoot, relativePath);
    const lexicalStat = await lstat(lexicalTarget);
    if (!lexicalStat.isFile()) return null;
    const canonicalTarget = await realpath(lexicalTarget);
    if (!isPathInsideRoot(canonicalRoot, canonicalTarget)) return null;
    const targetStat = await stat(canonicalTarget);
    return targetStat.isFile()
      ? { size: targetStat.size, targetPath: canonicalTarget }
      : null;
  } catch {
    return null;
  }
}

export async function readResolvedReviewFile(
  absolutePath: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const handle = await open(absolutePath, REVIEW_FILE_OPEN_FLAGS).catch(() => null);
  if (!handle) return null;
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) return null;
    if (fileStat.size === 0) return Buffer.alloc(0);
    const sample = Buffer.alloc(Math.min(fileStat.size, maxBytes));
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return bytesRead > 0 ? sample.subarray(0, bytesRead) : null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readReviewVersionSample(
  gitRoot: string,
  source: ReviewDiffFileSource,
  filePath: string,
): Promise<Buffer | null> {
  let relativePath: string;
  try {
    relativePath = normalizeReviewFilePath(gitRoot, filePath);
  } catch {
    return null;
  }
  if (source.kind === 'workspace') {
    const resolved = await resolveReviewWorkspaceFile(gitRoot, relativePath);
    return resolved
      ? readResolvedReviewFile(resolved.targetPath, REVIEW_FILE_KIND_SAMPLE_BYTES)
      : null;
  }
  const objectSpec = source.kind === 'index'
    ? `:${relativePath}`
    : `${source.revision}:${relativePath}`;
  return readGitFileSample(gitRoot, objectSpec);
}

function readGitFileSample(gitRoot: string, objectSpec: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      ['-c', 'core.quotepath=false', 'cat-file', 'blob', objectSpec],
      { cwd: gitRoot, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let settled = false;
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      const remaining = REVIEW_FILE_KIND_SAMPLE_BYTES - bytesRead;
      if (remaining > 0) {
        const content = chunk.subarray(0, remaining);
        chunks.push(content);
        bytesRead += content.byteLength;
      }
      if (bytesRead >= REVIEW_FILE_KIND_SAMPLE_BYTES) {
        child.stdout.destroy();
        child.kill();
        finish(Buffer.concat(chunks, bytesRead));
      }
    });
    child.once('error', () => finish(null));
    child.once('close', (code) => {
      finish(code === 0 && bytesRead > 0 ? Buffer.concat(chunks, bytesRead) : null);
    });
  });
}

function normalizeReviewFilePath(gitRoot: string, filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) throw new Error('Invalid review file path.');
  const absolutePath = path.resolve(gitRoot, trimmed);
  const relativePath = path.relative(gitRoot, absolutePath);
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    throw new Error('Review file path must stay inside the repository.');
  }
  return relativePath.split(path.sep).join('/');
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}
