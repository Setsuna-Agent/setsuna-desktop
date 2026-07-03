import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RuntimeMemoryPhase2Workspace, RuntimeMemoryPhase2WorkspaceChange, RuntimeMemoryPhase2WorkspaceChangeStatus } from '@setsuna-desktop/contracts';

const execFileAsync = promisify(execFile);
const PHASE2_WORKSPACE_DIFF_FILE = 'phase2_workspace_diff.md';
const MEMORY_INDEX_FILE = 'memories.json';
const PHASE2_WORKSPACE_DIFF_MAX_BYTES = 4 * 1024 * 1024;
const BASELINE_COMMIT_MESSAGE = 'Initialize Setsuna memory baseline';

export async function prepareMemoryPhase2Workspace(root: string): Promise<RuntimeMemoryPhase2Workspace> {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  await removeWorkspaceDiff(resolved);
  await ensureGitBaselineRepository(resolved);
  return { root: resolved, hasChanges: false, changes: [] };
}

export async function syncMemoryPhase2Workspace(root: string): Promise<RuntimeMemoryPhase2Workspace> {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  await removeWorkspaceDiff(resolved);
  await ensureGitBaselineRepository(resolved);

  const changes = parseGitStatus(await git(resolved, ['status', '--porcelain=v1', '--untracked-files=all']));
  if (!changes.length) return { root: resolved, hasChanges: false, changes: [] };

  await git(resolved, ['add', '-N', '.']).catch(() => undefined);
  const unifiedDiff = await git(resolved, ['diff', '--no-ext-diff', '--', '.', `:(exclude)${MEMORY_INDEX_FILE}`, `:(exclude)${PHASE2_WORKSPACE_DIFF_FILE}`]);
  const rendered = renderWorkspaceDiffFile(changes, unifiedDiff);
  const diffPath = path.join(resolved, PHASE2_WORKSPACE_DIFF_FILE);
  await writeFile(diffPath, rendered, 'utf8');
  return { root: resolved, hasChanges: true, changes, diffPath: PHASE2_WORKSPACE_DIFF_FILE };
}

export async function resetMemoryPhase2WorkspaceBaseline(root: string): Promise<RuntimeMemoryPhase2Workspace> {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  await removeWorkspaceDiff(resolved);
  await resetGitBaselineRepository(resolved);
  return { root: resolved, hasChanges: false, changes: [] };
}

async function ensureGitBaselineRepository(root: string): Promise<void> {
  const usable = await git(root, ['rev-parse', '--is-inside-work-tree'])
    .then((value) => value.trim() === 'true')
    .catch(() => false);
  const hasHead = usable && await git(root, ['rev-parse', '--verify', 'HEAD'])
    .then(() => true)
    .catch(() => false);
  if (hasHead) return;
  await resetGitBaselineRepository(root);
}

async function resetGitBaselineRepository(root: string): Promise<void> {
  await rm(path.join(root, '.git'), { recursive: true, force: true });
  await git(root, ['init']);
  await git(root, ['config', 'user.name', 'Setsuna']);
  await git(root, ['config', 'user.email', 'noreply@setsuna.local']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '--allow-empty', '-m', BASELINE_COMMIT_MESSAGE]);
}

async function removeWorkspaceDiff(root: string): Promise<void> {
  await rm(path.join(root, PHASE2_WORKSPACE_DIFF_FILE), { force: true });
}

async function git(cwd: string, args: string): Promise<string>;
async function git(cwd: string, args: string[]): Promise<string>;
async function git(cwd: string, args: string | string[]): Promise<string> {
  const list = Array.isArray(args) ? args : [args];
  const { stdout } = await execFileAsync('git', list, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function parseGitStatus(value: string): RuntimeMemoryPhase2WorkspaceChange[] {
  const changes: RuntimeMemoryPhase2WorkspaceChange[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const statusText = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const filePath = normalizeStatusPath(rawPath);
    if (!filePath || filePath === PHASE2_WORKSPACE_DIFF_FILE || filePath === MEMORY_INDEX_FILE || filePath.startsWith('.git/')) continue;
    const status = phase2ChangeStatus(statusText);
    const key = `${status}\0${filePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push({ status, path: filePath });
  }
  changes.sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status));
  return changes;
}

function normalizeStatusPath(value: string): string {
  const renamedPath = value.includes(' -> ') ? value.split(' -> ').at(-1) ?? value : value;
  return renamedPath.replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function phase2ChangeStatus(statusText: string): RuntimeMemoryPhase2WorkspaceChangeStatus {
  if (statusText === '??' || statusText.includes('A')) return 'A';
  if (statusText.includes('D')) return 'D';
  return 'M';
}

function renderWorkspaceDiffFile(changes: RuntimeMemoryPhase2WorkspaceChange[], unifiedDiff: string): string {
  let rendered = '# Memory Workspace Diff\n\n'
    + 'Generated by Setsuna before Phase 2 memory consolidation. Read this file first and do not edit it.\n\n'
    + '## Status\n';
  if (!changes.length) {
    rendered += '- none\n';
    return rendered;
  }
  for (const change of changes) rendered += `- ${change.status} ${change.path}\n`;
  rendered += '\n## Diff\n\n```diff\n';
  rendered += boundedDiff(unifiedDiff);
  rendered += '```\n';
  return rendered;
}

function boundedDiff(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= PHASE2_WORKSPACE_DIFF_MAX_BYTES) {
    return value.endsWith('\n') ? value : `${value}\n`;
  }
  const buffer = Buffer.from(value, 'utf8').subarray(0, PHASE2_WORKSPACE_DIFF_MAX_BYTES);
  const text = buffer.toString('utf8').replace(/\uFFFD+$/g, '');
  return `${text.endsWith('\n') ? text : `${text}\n`}\n[workspace diff truncated at ${PHASE2_WORKSPACE_DIFF_MAX_BYTES} bytes]\n`;
}
