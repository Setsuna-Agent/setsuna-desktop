import type {
  RuntimeMemoryPhase2Workspace,
  RuntimeMemoryPhase2WorkspaceChange,
  RuntimeMemoryPhase2WorkspaceChangeStatus,
} from '@setsuna-desktop/contracts';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfinedPathWithoutSymlinks } from '../../security/path-confinement.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

const PHASE2_WORKSPACE_DIFF_FILE = 'phase2_workspace_diff.md';
const PHASE2_BASELINE_FILE = '.setsuna-phase2-baseline.json';
const PHASE2_WORKSPACE_DIFF_MAX_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_TOP_LEVEL_FILES = new Set(['MEMORY.md', 'memory_summary.md', 'raw_memories.md']);
const SNAPSHOT_TOP_LEVEL_DIRECTORIES = new Set(['rollout_summaries', 'skills']);

type Phase2Baseline = {
  version: 1;
  files: Record<string, string>;
};

export async function prepareMemoryPhase2Workspace(root: string): Promise<RuntimeMemoryPhase2Workspace> {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  await removeWorkspaceDiff(resolved);
  await ensureBaseline(resolved);
  return { root: resolved, hasChanges: false, changes: [] };
}

export async function syncMemoryPhase2Workspace(root: string): Promise<RuntimeMemoryPhase2Workspace> {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  await removeWorkspaceDiff(resolved);
  const baseline = await ensureBaseline(resolved);
  const current = await snapshotMemoryFiles(resolved);
  const changes = compareSnapshots(baseline.files, current.files);
  if (!changes.length) return { root: resolved, hasChanges: false, changes: [] };

  const rendered = renderWorkspaceDiffFile(changes, baseline.files, current.files);
  const diffPath = path.join(resolved, PHASE2_WORKSPACE_DIFF_FILE);
  await writeFile(diffPath, rendered, 'utf8');
  return { root: resolved, hasChanges: true, changes, diffPath: PHASE2_WORKSPACE_DIFF_FILE };
}

export async function resetMemoryPhase2WorkspaceBaseline(root: string): Promise<RuntimeMemoryPhase2Workspace> {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  await removeWorkspaceDiff(resolved);
  await writeBaseline(resolved, await snapshotMemoryFiles(resolved));
  return { root: resolved, hasChanges: false, changes: [] };
}

async function ensureBaseline(root: string): Promise<Phase2Baseline> {
  const baselinePath = path.join(root, PHASE2_BASELINE_FILE);
  try {
    const stats = await lstat(baselinePath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Invalid memory Phase 2 baseline: ${baselinePath}`);
    const baseline = await readJsonFile<Phase2Baseline>(baselinePath, { version: 1, files: {} });
    if (baseline.version !== 1 || !isStringRecord(baseline.files)) {
      throw new Error(`Invalid memory Phase 2 baseline: ${baselinePath}`);
    }
    return baseline;
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
    const baseline = await snapshotMemoryFiles(root);
    await writeBaseline(root, baseline);
    return baseline;
  }
}

async function writeBaseline(root: string, baseline: Phase2Baseline): Promise<void> {
  await writeJsonFile(path.join(root, PHASE2_BASELINE_FILE), baseline, { mode: 0o600 });
}

async function snapshotMemoryFiles(root: string): Promise<Phase2Baseline> {
  const files: Record<string, string> = {};
  for (const fileName of [...SNAPSHOT_TOP_LEVEL_FILES].sort()) {
    await snapshotRegularFile(root, fileName, files);
  }
  for (const dirName of [...SNAPSHOT_TOP_LEVEL_DIRECTORIES].sort()) {
    await snapshotDirectory(root, dirName, files);
  }
  return { version: 1, files };
}

async function snapshotDirectory(root: string, relativeDir: string, files: Record<string, string>): Promise<void> {
  let entries;
  try {
    const absoluteDir = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativeDir), {
      allowMissing: false,
      label: 'Memory Phase 2 snapshot path',
    });
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) await snapshotDirectory(root, relativePath, files);
    if (entry.isFile()) await snapshotRegularFile(root, relativePath, files);
  }
}

async function snapshotRegularFile(root: string, relativePath: string, files: Record<string, string>): Promise<void> {
  try {
    const absolutePath = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativePath), {
      allowMissing: false,
      label: 'Memory Phase 2 snapshot path',
    });
    const stats = await lstat(absolutePath);
    if (!stats.isFile()) return;
    files[relativePath] = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }
}

function compareSnapshots(before: Record<string, string>, after: Record<string, string>): RuntimeMemoryPhase2WorkspaceChange[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((filePath) => before[filePath] !== after[filePath])
    .map((filePath) => ({ status: changeStatus(before, after, filePath), path: filePath }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status));
}

function changeStatus(
  before: Record<string, string>,
  after: Record<string, string>,
  filePath: string,
): RuntimeMemoryPhase2WorkspaceChangeStatus {
  if (!Object.hasOwn(before, filePath)) return 'A';
  if (!Object.hasOwn(after, filePath)) return 'D';
  return 'M';
}

async function removeWorkspaceDiff(root: string): Promise<void> {
  await rm(path.join(root, PHASE2_WORKSPACE_DIFF_FILE), { force: true });
}

function renderWorkspaceDiffFile(
  changes: RuntimeMemoryPhase2WorkspaceChange[],
  before: Record<string, string>,
  after: Record<string, string>,
): string {
  let rendered = '# Memory Workspace Diff\n\n'
    + 'Generated by Setsuna before Phase 2 memory consolidation. Read this file first and do not edit it.\n\n'
    + '## Status\n';
  for (const change of changes) rendered += `- ${change.status} ${change.path}\n`;
  rendered += '\n## Diff\n\n```diff\n';
  for (const change of changes) {
    rendered += renderFileDiff(change, before[change.path], after[change.path]);
  }
  rendered += '```\n';
  return boundedDiff(rendered);
}

function renderFileDiff(change: RuntimeMemoryPhase2WorkspaceChange, before: string | undefined, after: string | undefined): string {
  const oldPath = change.status === 'A' ? '/dev/null' : `a/${change.path}`;
  const newPath = change.status === 'D' ? '/dev/null' : `b/${change.path}`;
  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  let rendered = `diff --setsuna a/${change.path} b/${change.path}\n--- ${oldPath}\n+++ ${newPath}\n`;
  rendered += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
  for (const line of oldLines) rendered += `-${line}\n`;
  for (const line of newLines) rendered += `+${line}\n`;
  return rendered;
}

function splitDiffLines(value: string | undefined): string[] {
  if (value === undefined || value === '') return [];
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function boundedDiff(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= PHASE2_WORKSPACE_DIFF_MAX_BYTES) return value;
  const suffix = `\n[workspace diff truncated at ${PHASE2_WORKSPACE_DIFF_MAX_BYTES} bytes]\n\`\`\`\n`;
  const bodyLimit = Math.max(0, PHASE2_WORKSPACE_DIFF_MAX_BYTES - Buffer.byteLength(suffix, 'utf8'));
  const buffer = Buffer.from(value, 'utf8').subarray(0, bodyLimit);
  const text = buffer.toString('utf8').replace(/\uFFFD+$/g, '');
  return `${text.endsWith('\n') ? text : `${text}\n`}${suffix}`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === 'string'));
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
