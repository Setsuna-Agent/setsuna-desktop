import type {
  RuntimeMemoryFileList,
  RuntimeMemoryFileSearchMatch,
  RuntimeMemoryKind,
  RuntimeMemoryPreviewItem,
  RuntimeMemoryRecord,
  RuntimeMemorySearchMatchMode,
  RuntimeMemorySourceLocation,
  RuntimeMemoryStage1Output,
  RuntimeMemoryStage1Status
} from '@setsuna-desktop/contracts';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfinedPathWithoutSymlinks } from '../../security/path-confinement.js';

export type StoredMemoryRecord = RuntimeMemoryRecord & {
  kind?: string;
  status?: string;
};

export type StoredMemoryStage1Output = Omit<RuntimeMemoryStage1Output, 'status'> & {
  status?: string;
};

export type StoredMemoryPhase2Job = {
  status?: string;
  ownerId?: string;
  ownershipToken?: string;
  inputWatermark?: number;
  completedWatermark?: number;
  leaseExpiresAt?: string;
  retryAfter?: string;
  lastFailureReason?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type MemoryIndex = {
  version: 1;
  memories: StoredMemoryRecord[];
  stage1Outputs?: StoredMemoryStage1Output[];
  phase2Job?: StoredMemoryPhase2Job;
};

export const DEFAULT_MEMORY_LIMIT = 50;
export const MAX_MEMORY_LIMIT = 500;
export const MEMORY_FILE_NAME = 'memories.json';
export const MEMORY_MARKDOWN_FILE_NAME = 'MEMORY.md';
export const MEMORY_SUMMARY_FILE_NAME = 'memory_summary.md';
export const RAW_MEMORIES_FILE_NAME = 'raw_memories.md';
export const ROLLOUT_SUMMARIES_DIR_NAME = 'rollout_summaries';
export const SKILLS_DIR_NAME = 'skills';
export const MEMORY_PREVIEW_MAX_ITEMS = 500;
export const MEMORY_PREVIEW_SNIPPET_CHARS = 1200;
export const DEFAULT_MEMORY_FILE_LIST_LIMIT = 50;
export const DEFAULT_MEMORY_FILE_SEARCH_LIMIT = 50;
export const MAX_MEMORY_FILE_RESULTS = 200;
export const MAX_MEMORY_CONTENT_CHARS = 4000;
export const MAX_MEMORY_TITLE_CHARS = 80;
export const MAX_MEMORY_SOURCE_CHARS = 160;
export const MAX_MEMORY_TAG_CHARS = 40;
export const MAX_MEMORY_TAGS = 8;
export const MAX_STAGE1_RAW_MEMORY_CHARS = 60_000;
export const MAX_STAGE1_ROLLOUT_SUMMARY_CHARS = 4_000;
export const MAX_STAGE1_ROLLOUT_SLUG_CHARS = 80;
export const MAX_STAGE1_FAILURE_REASON_CHARS = 500;
export const MAX_PHASE2_FAILURE_REASON_CHARS = 500;
export const MEMORY_KINDS = new Set<RuntimeMemoryKind>(['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note']);

export type StorageRootResolver = () => Promise<string | null | undefined> | string | null | undefined;

export function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MEMORY_LIMIT;
  return Math.max(1, Math.min(MAX_MEMORY_LIMIT, Math.floor(value)));
}

export function clampResultLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_MEMORY_FILE_RESULTS, Math.floor(value)));
}

export function cursorIndex(value: unknown, max: number): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error('Invalid memory file cursor.');
  return parsed;
}

export function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Expected a positive integer.');
  return parsed;
}

export function normalizeMemoryFilePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw new Error(`Invalid memory file path: ${value}`);
  }
  const text = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!text) return undefined;
  const parts = text.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.' || part.startsWith('.'))) {
    throw new Error(`Invalid memory file path: ${value}`);
  }
  return parts.join('/');
}

export function normalizeRequiredMemoryFilePath(value: unknown): string {
  const text = normalizeMemoryFilePath(value);
  if (!text) throw new Error('Memory file path is required.');
  return text;
}

export function normalizeMemoryIndex(value: MemoryIndex): MemoryIndex {
  return {
    version: 1,
    memories: Array.isArray(value.memories) ? value.memories : [],
    stage1Outputs: normalizeStage1Outputs(value.stage1Outputs),
    phase2Job: normalizePhase2Job(value.phase2Job),
  };
}

export function normalizeStage1Outputs(value: unknown): StoredMemoryStage1Output[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is StoredMemoryStage1Output => Boolean(item && typeof item === 'object'))
        .map((item) => ({ ...item, status: normalizeStage1Status(item.status) }))
    : [];
}

export function normalizePhase2Job(value: unknown): StoredMemoryPhase2Job {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as StoredMemoryPhase2Job;
  return {
    status: typeof record.status === 'string' ? record.status : undefined,
    ownerId: optionalText(record.ownerId),
    ownershipToken: optionalText(record.ownershipToken),
    inputWatermark: normalizedWatermark(record.inputWatermark),
    completedWatermark: normalizedWatermark(record.completedWatermark),
    leaseExpiresAt: validIsoDate(record.leaseExpiresAt),
    retryAfter: validIsoDate(record.retryAfter),
    lastFailureReason: optionalText(record.lastFailureReason, MAX_PHASE2_FAILURE_REASON_CHARS),
    createdAt: validIsoDate(record.createdAt),
    updatedAt: validIsoDate(record.updatedAt),
  };
}

export async function shouldPreserveExistingArtifact(root: string, relativePath: string): Promise<boolean> {
  if (relativePath !== MEMORY_MARKDOWN_FILE_NAME && relativePath !== MEMORY_SUMMARY_FILE_NAME) return false;
  const target = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativePath), { label: 'Memory artifact' });
  let content = '';
  try {
    content = await readFile(target, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
  // 第二阶段写入会成为持久化真源。生成的回退内容保留标记，并可在首次真正整合成功前
  // 从 memories.json 刷新。
  return !content.includes('Generated from memories.json.');
}

export async function overlayStoredMemoryArtifacts(artifacts: RenderedMemoryArtifacts, root: string): Promise<RenderedMemoryArtifacts> {
  const files = new Map(artifacts.files);
  await overlayStoredFile(files, root, MEMORY_MARKDOWN_FILE_NAME);
  await overlayStoredFile(files, root, MEMORY_SUMMARY_FILE_NAME);
  await overlayStoredDirectory(files, root, SKILLS_DIR_NAME);
  return {
    ...artifacts,
    files,
  };
}

export async function overlayStoredFile(files: Map<string, string>, root: string, relativePath: string): Promise<void> {
  try {
    const target = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativePath), { label: 'Memory artifact' });
    files.set(relativePath, await readFile(target, 'utf8'));
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }
}

export async function overlayStoredDirectory(files: Map<string, string>, root: string, relativeDir: string): Promise<void> {
  const dir = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativeDir), { label: 'Memory artifact' });
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return;
    const relativePath = path.posix.join(relativeDir, entry.name);
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await overlayStoredDirectory(files, root, relativePath);
      return;
    }
    if (!entry.isFile()) return;
    files.set(relativePath, await readFile(absolutePath, 'utf8'));
  }));
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

export function optionalText(value: unknown, maxChars?: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = compactText(value, maxChars);
  return text || undefined;
}

export function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tag = optionalText(item, MAX_MEMORY_TAG_CHARS);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_MEMORY_TAGS) break;
  }
  return tags.length ? tags : undefined;
}

export function normalizeMemoryKind(value: unknown): RuntimeMemoryKind {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return MEMORY_KINDS.has(kind as RuntimeMemoryKind) ? kind as RuntimeMemoryKind : 'note';
}

export function memoryTitle(value: unknown, content: string): string | undefined {
  return optionalText(value, MAX_MEMORY_TITLE_CHARS) ?? firstMemoryLine(content);
}

export function compactText(value: unknown, maxChars: number | undefined): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!maxChars || text.length <= maxChars) return text;
  return Array.from(text).slice(0, maxChars).join('');
}

export function compactMultilineText(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (text.length <= maxChars) return text;
  return Array.from(text).slice(0, maxChars).join('').trimEnd();
}

export function validIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function memoryDedupeKey(memory: Pick<RuntimeMemoryRecord, 'scope' | 'projectId' | 'workspaceRoot' | 'content'> & { kind?: unknown }): string {
  return [
    memory.scope === 'project' ? 'project' : 'global',
    normalizeMemoryKind(memory.kind),
    compactText(memory.content, undefined).toLowerCase(),
    memory.scope === 'project' ? path.resolve(String(memory.workspaceRoot || memory.projectId || '')) : '',
  ].join('\0');
}

export function memoryWithSourceLocation(memory: StoredMemoryRecord, sourceLocation: RuntimeMemorySourceLocation | undefined): RuntimeMemoryRecord {
  return {
    ...memory,
    kind: normalizeMemoryKind(memory.kind),
    sourceLocation,
  };
}

export function storedMemoryForWrite(memory: StoredMemoryRecord): StoredMemoryRecord {
  const { sourceLocation: _sourceLocation, ...persisted } = memory;
  return persisted;
}

export function storedStage1OutputForWrite(output: StoredMemoryStage1Output): StoredMemoryStage1Output {
  return { ...output, status: normalizeStage1Status(output.status) };
}

export function storedPhase2JobForWrite(value: unknown): StoredMemoryPhase2Job | undefined {
  const job = normalizePhase2Job(value);
  return job.status ? job : undefined;
}

export function stage1OutputForRead(output: StoredMemoryStage1Output): RuntimeMemoryStage1Output {
  return {
    ...output,
    status: normalizeStage1Status(output.status),
    rawMemory: String(output.rawMemory || ''),
    rolloutSummary: String(output.rolloutSummary || ''),
    sourceUpdatedAt: validIsoDate(output.sourceUpdatedAt) ?? '',
    createdAt: validIsoDate(output.createdAt) ?? '',
    updatedAt: validIsoDate(output.updatedAt) ?? '',
  };
}

export function memoryMatchesRolloutIds(memory: StoredMemoryRecord, rolloutIds: string[]): boolean {
  const ids = new Set(rolloutIds);
  return Boolean(
    (memory.sourceThreadId && ids.has(memory.sourceThreadId))
    || (memory.id && ids.has(memory.id))
  );
}

export function stage1OutputDedupeKey(output: Pick<StoredMemoryStage1Output, 'threadId' | 'turnId'>): string {
  return `${output.threadId}\0${output.turnId ?? ''}`;
}

export function stage1OutputMatchesRolloutIds(output: StoredMemoryStage1Output, rolloutIds: string[]): boolean {
  const ids = new Set(rolloutIds);
  return Boolean(
    (output.threadId && ids.has(output.threadId))
    || (output.id && ids.has(output.id))
  );
}

export function normalizedUsageCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
}

export function isInactiveMemory(memory: StoredMemoryRecord): boolean {
  return memory.status === 'archived' || memory.status === 'deleted';
}

export function isInactiveStage1Output(output: StoredMemoryStage1Output): boolean {
  return output.status === 'archived' || output.status === 'deleted';
}

export function isRenderableStage1Output(output: StoredMemoryStage1Output): boolean {
  return !isInactiveStage1Output(output)
    && normalizeStage1Status(output.status) === 'succeeded'
    && Boolean(String(output.rawMemory || '').trim())
    && Boolean(String(output.rolloutSummary || '').trim());
}

export function normalizeStage1Status(value: unknown): RuntimeMemoryStage1Status {
  return value === 'succeeded_no_output' || value === 'failed' ? value : 'succeeded';
}

export function phase2InputWatermark(outputs: unknown): number {
  return normalizeStage1Outputs(outputs)
    .filter(isRenderableStage1Output)
    .map((output) => Date.parse(output.sourceUpdatedAt))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, Math.floor(value / 1000)), 0);
}

export function normalizedWatermark(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function futureTimestampMs(value: unknown, nowMs: number): boolean {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && timestamp > nowMs;
}

export function memoryPreviewItem(memory: StoredMemoryRecord, root: string): RuntimeMemoryPreviewItem | null {
  if (isInactiveMemory(memory)) return null;
  const content = String(memory.content || '').trim();
  if (!content) return null;
  return {
    id: memory.id || 'memory',
    title: memory.title || firstMemoryLine(content) || '记忆',
    scope: memory.scope === 'project' ? 'project' : 'global',
    origin: memory.origin === 'passive' ? 'passive' : 'active',
    kind: normalizeMemoryKind(memory.kind),
    source: memory.source || memory.sourceThreadId,
    projectId: memory.projectId,
    workspaceRoot: memory.workspaceRoot,
    storageRoot: root,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt || memory.createdAt || '',
    chars: Array.from(content).length,
    preview: memoryPreviewSnippet(content),
    tags: Array.isArray(memory.tags) ? memory.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : undefined,
  };
}

export function firstMemoryLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 80) ?? '';
}

export function memoryPreviewSnippet(value: string): string {
  return Array.from(value.trim()).slice(0, MEMORY_PREVIEW_SNIPPET_CHARS).join('');
}

export function memoryPreviewSortKey(item: RuntimeMemoryPreviewItem): string {
  return `${item.updatedAt}\0${item.title}\0${item.id}`;
}

export type RenderedMemoryArtifacts = {
  files: Map<string, string>;
  locations: Map<string, RuntimeMemorySourceLocation>;
};

export function renderMemoryArtifacts(index: MemoryIndex): RenderedMemoryArtifacts {
  const memoryMarkdown = renderMemoryMarkdown(index);
  const files = new Map<string, string>([
    [MEMORY_MARKDOWN_FILE_NAME, memoryMarkdown.body],
    [MEMORY_SUMMARY_FILE_NAME, renderMemorySummary(index)],
    [RAW_MEMORIES_FILE_NAME, renderRawMemories(index)],
  ]);
  for (const [filePath, content] of renderRolloutSummaries(index)) {
    files.set(filePath, content);
  }
  return {
    files,
    locations: memoryMarkdown.locations,
  };
}

export type RenderedMemoryMarkdown = {
  body: string;
  locations: Map<string, RuntimeMemorySourceLocation>;
};

export function renderMemoryMarkdown(index: MemoryIndex): RenderedMemoryMarkdown {
  const lines: string[] = [
    '# Setsuna Memories',
    '',
    '<!-- Generated from memories.json. Do not edit manually. -->',
    '',
  ];
  const locations = new Map<string, RuntimeMemorySourceLocation>();
  const activeMemories = index.memories.filter((memory) => !isInactiveMemory(memory));

  if (!activeMemories.length) {
    lines.push('No memories yet.');
    return { body: `${lines.join('\n')}\n`, locations };
  }

  for (const memory of activeMemories) {
    const title = markdownHeadingText(memory.title || firstMemoryLine(String(memory.content || '')) || '记忆');
    const kind = normalizeMemoryKind(memory.kind);
    lines.push(`## ${title}`);
    lines.push(`id: ${memory.id}`);
    lines.push(`scope: ${memory.scope === 'project' ? 'project' : 'global'}`);
    if (memory.projectId) lines.push(`project_id: ${memory.projectId}`);
    lines.push(`kind: ${kind}`);
    lines.push(`origin: ${memory.origin === 'passive' ? 'passive' : 'active'}`);
    if (memory.source) lines.push(`source: ${memory.source}`);
    if (memory.sourceThreadId) lines.push(`source_thread_id: ${memory.sourceThreadId}`);
    if (memory.sourceTurnId) lines.push(`source_turn_id: ${memory.sourceTurnId}`);
    if (memory.workspaceRoot) lines.push(`workspace_root: ${memory.workspaceRoot}`);
    if (Array.isArray(memory.tags) && memory.tags.length) lines.push(`tags: ${memory.tags.join(', ')}`);
    if (memory.usageCount) lines.push(`usage_count: ${memory.usageCount}`);
    if (memory.lastUsedAt) lines.push(`last_used_at: ${memory.lastUsedAt}`);
    lines.push(`updated_at: ${memory.updatedAt || memory.createdAt || ''}`);
    lines.push('');

    const lineStart = lines.length + 1;
    const contentLines = markdownMemoryContent(String(memory.content || ''));
    lines.push(...contentLines);
    const lineEnd = lines.length;
    if (memory.id) {
      locations.set(memory.id, {
        path: MEMORY_MARKDOWN_FILE_NAME,
        lineStart,
        lineEnd,
        note: title,
      });
    }
    lines.push('');
  }

  return { body: `${lines.join('\n')}\n`, locations };
}

export function markdownHeadingText(value: string): string {
  return compactText(value, MAX_MEMORY_TITLE_CHARS).replace(/^[#\s]+/, '') || '记忆';
}

export function markdownMemoryContent(value: string): string[] {
  const lines = String(value).trim().split(/\r?\n/).map((line) => line.trimEnd());
  return lines.length ? lines : [''];
}

export function renderMemorySummary(index: MemoryIndex): string {
  const activeMemories = index.memories.filter((memory) => !isInactiveMemory(memory));
  const lines = ['# Memory Summary', '', '<!-- Generated from memories.json. Do not edit manually. -->', ''];
  if (!activeMemories.length) {
    lines.push('No memories yet.');
    return `${lines.join('\n')}\n`;
  }
  const byKind = new Map<RuntimeMemoryKind, StoredMemoryRecord[]>();
  for (const memory of activeMemories) {
    const kind = normalizeMemoryKind(memory.kind);
    byKind.set(kind, [...(byKind.get(kind) ?? []), memory]);
  }
  for (const kind of MEMORY_KINDS) {
    const memories = byKind.get(kind);
    if (!memories?.length) continue;
    lines.push(`## ${memoryKindLabel(kind)}`);
    for (const memory of memories) {
      const scope = memory.scope === 'project' ? `project:${memory.projectId ?? 'unknown'}` : 'global';
      lines.push(`- [${scope}] ${compactText(memory.content, 280)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderRawMemories(index: MemoryIndex): string {
  const activeMemories = index.memories.filter((memory) => !isInactiveMemory(memory));
  const activeStage1Outputs = normalizeStage1Outputs(index.stage1Outputs).filter(isRenderableStage1Output);
  const lines = ['# Raw Memories', '', 'Merged stage-1 raw memories (stable ascending thread-id order):', ''];
  if (activeStage1Outputs.length) {
    for (const output of activeStage1Outputs.sort(stage1RawMemorySort)) {
      lines.push(`## Thread \`${output.threadId}\``);
      lines.push(`updated_at: ${output.sourceUpdatedAt}`);
      if (output.cwd) lines.push(`cwd: ${output.cwd}`);
      if (output.projectId) lines.push(`project_id: ${output.projectId}`);
      if (output.rolloutPath) lines.push(`rollout_path: ${output.rolloutPath}`);
      lines.push(`rollout_summary_file: ${stage1RolloutSummaryFileName(output)}`);
      if (output.usageCount) lines.push(`usage_count: ${output.usageCount}`);
      if (output.lastUsedAt) lines.push(`last_used_at: ${output.lastUsedAt}`);
      lines.push('');
      lines.push(output.rawMemory.trim());
      lines.push('');
    }
    return `${lines.join('\n').trimEnd()}\n`;
  }
  if (!activeMemories.length) {
    lines.push('No raw memories yet.');
    return `${lines.join('\n')}\n`;
  }
  for (const memory of activeMemories) {
    lines.push(`## Memory \`${memory.id || 'memory'}\``);
    lines.push(`updated_at: ${memory.updatedAt || memory.createdAt || ''}`);
    lines.push(`scope: ${memory.scope === 'project' ? 'project' : 'global'}`);
    if (memory.projectId) lines.push(`project_id: ${memory.projectId}`);
    if (memory.sourceThreadId) lines.push(`thread_id: ${memory.sourceThreadId}`);
    if (memory.sourceTurnId) lines.push(`turn_id: ${memory.sourceTurnId}`);
    if (memory.workspaceRoot) lines.push(`cwd: ${memory.workspaceRoot}`);
    if (memory.usageCount) lines.push(`usage_count: ${memory.usageCount}`);
    if (memory.lastUsedAt) lines.push(`last_used_at: ${memory.lastUsedAt}`);
    lines.push(`rollout_summary_file: ${rolloutSummaryFileName(memory)}`);
    lines.push('');
    lines.push(String(memory.content || '').trim());
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderRolloutSummaries(index: MemoryIndex): Map<string, string> {
  const files = new Map<string, string>();
  const activeStage1Outputs = normalizeStage1Outputs(index.stage1Outputs).filter(isRenderableStage1Output);
  for (const output of activeStage1Outputs) {
    const lines = [
      `thread_id: ${output.threadId}`,
      `updated_at: ${output.sourceUpdatedAt}`,
    ];
    if (output.rolloutPath) lines.push(`rollout_path: ${output.rolloutPath}`);
    if (output.cwd) lines.push(`cwd: ${output.cwd}`);
    if (output.projectId) lines.push(`project_id: ${output.projectId}`);
    if (output.usageCount) lines.push(`usage_count: ${output.usageCount}`);
    if (output.lastUsedAt) lines.push(`last_used_at: ${output.lastUsedAt}`);
    lines.push('');
    lines.push(output.rolloutSummary.trim());
    files.set(`${ROLLOUT_SUMMARIES_DIR_NAME}/${stage1RolloutSummaryFileName(output)}`, `${lines.join('\n').trimEnd()}\n`);
  }
  if (activeStage1Outputs.length) return files;

  const groups = new Map<string, StoredMemoryRecord[]>();
  for (const memory of index.memories.filter((item) => !isInactiveMemory(item))) {
    const key = rolloutSummaryKey(memory);
    groups.set(key, [...(groups.get(key) ?? []), memory]);
  }
  for (const memories of groups.values()) {
    const first = memories[0];
    const lines = [
      `thread_id: ${first.sourceThreadId || first.id || 'memory'}`,
      `updated_at: ${memories.map((memory) => memory.updatedAt || memory.createdAt || '').sort().at(-1) ?? ''}`,
    ];
    const usageCount = memories.reduce((total, memory) => total + normalizedUsageCount(memory.usageCount), 0);
    const lastUsedAt = memories.map((memory) => memory.lastUsedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
    if (usageCount) lines.push(`usage_count: ${usageCount}`);
    if (lastUsedAt) lines.push(`last_used_at: ${lastUsedAt}`);
    if (first.workspaceRoot) lines.push(`cwd: ${first.workspaceRoot}`);
    if (first.projectId) lines.push(`project_id: ${first.projectId}`);
    lines.push('');
    for (const memory of memories) {
      lines.push(`- [${normalizeMemoryKind(memory.kind)}] ${String(memory.content || '').trim()}`);
    }
    files.set(`${ROLLOUT_SUMMARIES_DIR_NAME}/${rolloutSummaryFileName(first)}`, `${lines.join('\n').trimEnd()}\n`);
  }
  return files;
}

export function memoryFileEntries(artifacts: RenderedMemoryArtifacts, requestedPath: string | undefined): RuntimeMemoryFileList['entries'] | null {
  const allPaths = [...artifacts.files.keys()].sort();
  if (requestedPath && artifacts.files.has(requestedPath)) return [{ path: requestedPath, entryType: 'file' }];
  const prefix = requestedPath ? `${requestedPath}/` : '';
  const entries = new Map<string, RuntimeMemoryFileList['entries'][number]>();
  for (const filePath of allPaths) {
    if (requestedPath && !filePath.startsWith(prefix)) continue;
    const suffix = requestedPath ? filePath.slice(prefix.length) : filePath;
    if (!suffix) continue;
    const separatorIndex = suffix.indexOf('/');
    const childName = separatorIndex >= 0 ? suffix.slice(0, separatorIndex) : suffix;
    const childPath = prefix ? `${requestedPath}/${childName}` : childName;
    entries.set(childPath, {
      path: childPath,
      entryType: separatorIndex >= 0 ? 'directory' : 'file',
    });
  }
  return entries.size ? [...entries.values()].sort(memoryFileEntrySort) : null;
}

export function memorySearchFiles(artifacts: RenderedMemoryArtifacts, requestedPath: string | undefined): Array<[string, string]> {
  const files = [...artifacts.files.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (!requestedPath) return files;
  const content = artifacts.files.get(requestedPath);
  if (content !== undefined) return [[requestedPath, content]];
  const prefix = `${requestedPath}/`;
  return files.filter(([filePath]) => filePath.startsWith(prefix));
}

export function memoryFileEntrySort(left: RuntimeMemoryFileList['entries'][number], right: RuntimeMemoryFileList['entries'][number]): number {
  const leftPriority = rootMemoryEntryPriority(left.path);
  const rightPriority = rootMemoryEntryPriority(right.path);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.path.localeCompare(right.path);
}

export function rootMemoryEntryPriority(filePath: string): number {
  if (filePath === MEMORY_MARKDOWN_FILE_NAME) return 0;
  if (filePath === MEMORY_SUMMARY_FILE_NAME) return 1;
  if (filePath === RAW_MEMORIES_FILE_NAME) return 2;
  if (filePath === ROLLOUT_SUMMARIES_DIR_NAME) return 3;
  if (filePath === SKILLS_DIR_NAME) return 4;
  return 10;
}

export function memoryKindLabel(kind: RuntimeMemoryKind): string {
  if (kind === 'project_rule') return 'Project Rules';
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1).replaceAll('_', ' ')}s`;
}

export function rolloutSummaryKey(memory: StoredMemoryRecord): string {
  return memory.sourceThreadId || memory.id || memory.content;
}

export function rolloutSummaryFileName(memory: StoredMemoryRecord): string {
  return `${safeArtifactStem(rolloutSummaryKey(memory))}.md`;
}

export function stage1RolloutSummaryFileName(output: StoredMemoryStage1Output): string {
  const slug = stage1RolloutSlugFilePart(output.rolloutSlug);
  return `${stage1FileTimestamp(output.sourceUpdatedAt)}-${stage1ThreadShortHash(output.threadId)}${slug ? `-${slug}` : ''}.md`;
}

export function stage1RawMemorySort(left: StoredMemoryStage1Output, right: StoredMemoryStage1Output): number {
  return String(left.threadId || '').localeCompare(String(right.threadId || ''))
    || String(left.sourceUpdatedAt || '').localeCompare(String(right.sourceUpdatedAt || ''));
}

export function safeArtifactStem(value: string): string {
  const text = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return text || 'memory';
}

export function stage1FileTimestamp(value: unknown): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date(0);
  const pad = (item: number) => String(item).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    '-',
    pad(date.getUTCMinutes()),
    '-',
    pad(date.getUTCSeconds()),
  ].join('');
}

export function stage1ThreadShortHash(value: unknown): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let seed = 0;
  for (const byte of Buffer.from(String(value || ''), 'utf8')) {
    seed = (Math.imul(seed, 31) + byte) >>> 0;
  }
  let number = seed % 14_776_336;
  const chars = ['0', '0', '0', '0'];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    chars[index] = alphabet[number % alphabet.length];
    number = Math.floor(number / alphabet.length);
  }
  return chars.join('');
}

export function stage1RolloutSlugFilePart(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let slug = '';
  for (const char of raw) {
    if (slug.length >= 60) break;
    slug += /[a-zA-Z0-9]/.test(char) ? char.toLowerCase() : '_';
  }
  return slug.replace(/_+$/g, '').replace(/^_+/g, '');
}

export function normalizeSearchMatchMode(value: RuntimeMemorySearchMatchMode | undefined): RuntimeMemorySearchMatchMode {
  if (value === 'all_on_same_line' || value === 'any') return value;
  if (value && typeof value === 'object' && value.type === 'all_within_lines') {
    return { type: 'all_within_lines', lineCount: Math.max(1, Math.floor(value.lineCount)) };
  }
  return 'any';
}

export function searchMemoryLines(input: {
  caseSensitive: boolean;
  contextLines: number;
  lines: string[];
  mode: RuntimeMemorySearchMatchMode;
  path: string;
  queries: string[];
}): RuntimeMemoryFileSearchMatch[] {
  const haystackLines = input.caseSensitive ? input.lines : input.lines.map((line) => line.toLowerCase());
  const queries = input.caseSensitive ? input.queries : input.queries.map((query) => query.toLowerCase());
  const matchedFlags = haystackLines.map((line) => queries.map((query) => line.includes(query)));
  const matches: RuntimeMemoryFileSearchMatch[] = [];
  if (input.mode === 'any') {
    for (let index = 0; index < input.lines.length; index += 1) {
      const flags = matchedFlags[index];
      if (flags.some(Boolean)) matches.push(memorySearchMatch(input, index, index, matchedQueries(input.queries, flags)));
    }
    return matches;
  }
  if (input.mode === 'all_on_same_line') {
    for (let index = 0; index < input.lines.length; index += 1) {
      const flags = matchedFlags[index];
      if (flags.every(Boolean)) matches.push(memorySearchMatch(input, index, index, matchedQueries(input.queries, flags)));
    }
    return matches;
  }

  const lineCount = input.mode.lineCount;
  for (let start = 0; start < input.lines.length; start += 1) {
    const aggregate = queries.map(() => false);
    const endLimit = Math.min(input.lines.length - 1, start + lineCount - 1);
    for (let end = start; end <= endLimit; end += 1) {
      matchedFlags[end].forEach((flag, index) => {
        aggregate[index] ||= flag;
      });
      if (aggregate.every(Boolean)) {
        matches.push(memorySearchMatch(input, start, end, matchedQueries(input.queries, aggregate)));
        break;
      }
    }
  }
  return matches;
}

export function memorySearchMatch(
  input: { contextLines: number; lines: string[]; path: string },
  matchStartIndex: number,
  matchEndIndex: number,
  matchedQueries: string[],
): RuntimeMemoryFileSearchMatch {
  const contentStartIndex = Math.max(0, matchStartIndex - input.contextLines);
  const contentEndIndex = Math.min(input.lines.length - 1, matchEndIndex + input.contextLines);
  return {
    path: input.path,
    matchLineNumber: matchStartIndex + 1,
    contentStartLineNumber: contentStartIndex + 1,
    content: input.lines.slice(contentStartIndex, contentEndIndex + 1).join('\n'),
    matchedQueries,
  };
}

export function matchedQueries(queries: string[], flags: boolean[]): string[] {
  return queries.filter((_query, index) => flags[index]);
}
