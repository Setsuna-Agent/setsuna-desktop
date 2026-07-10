import type { Dirent } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CreateRuntimeMemoryInput,
  CreateRuntimeMemoryStage1OutputInput,
  RuntimeMemoryList,
  RuntimeMemoryFileList,
  RuntimeMemoryFileRead,
  RuntimeMemoryFileReadInput,
  RuntimeMemoryFileSearch,
  RuntimeMemoryFileSearchInput,
  RuntimeMemoryFileSearchMatch,
  RuntimeMemorySearchMatchMode,
  RuntimeMemoryCitation,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
  RuntimeMemoryPhase2JobClaim,
  RuntimeMemoryPhase2Workspace,
  RuntimeMemoryStage1Output,
  RuntimeMemoryStage1OutputList,
  RuntimeMemoryStage1Status,
  RuntimeMemoryKind,
  RuntimeMemorySourceLocation,
  RuntimeMemoryScope,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';
import { withFileStateUpdate } from './file-state-coordinator.js';
import { prepareMemoryPhase2Workspace, resetMemoryPhase2WorkspaceBaseline, syncMemoryPhase2Workspace } from './memory-phase2-workspace.js';

type StoredMemoryRecord = RuntimeMemoryRecord & {
  kind?: string;
  status?: string;
};

type StoredMemoryStage1Output = Omit<RuntimeMemoryStage1Output, 'status'> & {
  status?: string;
};

type StoredMemoryPhase2Job = {
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

type MemoryIndex = {
  version: 1;
  memories: StoredMemoryRecord[];
  stage1Outputs?: StoredMemoryStage1Output[];
  phase2Job?: StoredMemoryPhase2Job;
};

const DEFAULT_MEMORY_LIMIT = 50;
const MAX_MEMORY_LIMIT = 500;
const MEMORY_FILE_NAME = 'memories.json';
const DEFAULT_MEMORY_DIR_NAME = 'memories';
const MEMORY_MARKDOWN_FILE_NAME = 'MEMORY.md';
const MEMORY_SUMMARY_FILE_NAME = 'memory_summary.md';
const RAW_MEMORIES_FILE_NAME = 'raw_memories.md';
const ROLLOUT_SUMMARIES_DIR_NAME = 'rollout_summaries';
const SKILLS_DIR_NAME = 'skills';
const MEMORY_PREVIEW_MAX_ITEMS = 500;
const MEMORY_PREVIEW_SNIPPET_CHARS = 1200;
const DEFAULT_MEMORY_FILE_LIST_LIMIT = 50;
const DEFAULT_MEMORY_FILE_SEARCH_LIMIT = 50;
const MAX_MEMORY_FILE_RESULTS = 200;
const MAX_MEMORY_CONTENT_CHARS = 4000;
const MAX_MEMORY_TITLE_CHARS = 80;
const MAX_MEMORY_SOURCE_CHARS = 160;
const MAX_MEMORY_TAG_CHARS = 40;
const MAX_MEMORY_TAGS = 8;
const MAX_STAGE1_RAW_MEMORY_CHARS = 60_000;
const MAX_STAGE1_ROLLOUT_SUMMARY_CHARS = 4_000;
const MAX_STAGE1_ROLLOUT_SLUG_CHARS = 80;
const MAX_STAGE1_FAILURE_REASON_CHARS = 500;
const MAX_PHASE2_FAILURE_REASON_CHARS = 500;
const MEMORY_KINDS = new Set<RuntimeMemoryKind>(['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note']);

type StorageRootResolver = () => Promise<string | null | undefined> | string | null | undefined;

export class FileMemoryStore implements MemoryStore {
  constructor(
    private readonly dataDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly storageRootResolver?: StorageRootResolver,
  ) {}

  async listMemories(query: RuntimeMemoryQuery = {}): Promise<RuntimeMemoryList> {
    const entries = await this.readMergedMemoryEntries();
    const search = query.search?.trim().toLowerCase();
    const memories = entries
      .map((entry) => memoryWithSourceLocation(entry.memory, entry.sourceLocation))
      .filter((memory) => !isInactiveMemory(memory))
      .filter((memory) => !query.scope || memory.scope === query.scope)
      .filter((memory) => !query.projectId || memory.scope === 'global' || memory.projectId === query.projectId)
      .filter((memory) => !search || memory.content.toLowerCase().includes(search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, clampLimit(query.limit));
    return { memories };
  }

  async listMemoryFiles(query: { path?: string; cursor?: string; maxResults?: number } = {}): Promise<RuntimeMemoryFileList> {
    const artifacts = await this.mergedMemoryArtifacts();
    const requestedPath = normalizeMemoryFilePath(query.path);
    const entries = memoryFileEntries(artifacts, requestedPath);
    if (!entries) {
      throw new Error(`Memory file not found: ${query.path}`);
    }

    const start = cursorIndex(query.cursor, entries.length);
    const limit = clampResultLimit(query.maxResults, DEFAULT_MEMORY_FILE_LIST_LIMIT);
    const end = Math.min(entries.length, start + limit);
    return {
      path: query.path,
      entries: entries.slice(start, end),
      nextCursor: end < entries.length ? String(end) : null,
      truncated: end < entries.length,
    };
  }

  async readMemoryFile(input: RuntimeMemoryFileReadInput): Promise<RuntimeMemoryFileRead> {
    const pathName = normalizeRequiredMemoryFilePath(input.path);
    const artifacts = await this.mergedMemoryArtifacts();
    const body = artifacts.files.get(pathName);
    if (body === undefined) throw new Error(`Memory file not found: ${input.path}`);
    const lineOffset = positiveInteger(input.lineOffset, 1);
    const maxLines = input.maxLines === undefined ? undefined : positiveInteger(input.maxLines, 1);
    const lines = body.split(/(?<=\n)/);
    if (lineOffset > Math.max(lines.length, 1)) throw new Error('Memory file line_offset exceeds file length.');
    const startIndex = lineOffset - 1;
    const selected = maxLines === undefined ? lines.slice(startIndex) : lines.slice(startIndex, startIndex + maxLines);
    const endIndex = startIndex + selected.length;
    return {
      path: pathName,
      content: selected.join(''),
      startLineNumber: lineOffset,
      truncated: endIndex < lines.length,
    };
  }

  async searchMemoryFiles(input: RuntimeMemoryFileSearchInput): Promise<RuntimeMemoryFileSearch> {
    const queries = input.queries.map((query) => query.trim()).filter(Boolean);
    if (!queries.length) throw new Error('Memory search requires at least one query.');
    const artifacts = await this.mergedMemoryArtifacts();
    const pathName = input.path ? normalizeRequiredMemoryFilePath(input.path) : undefined;
    const files = memorySearchFiles(artifacts, pathName);
    if (!files.length) throw new Error(`Memory file not found: ${String(input.path)}`);
    const mode = normalizeSearchMatchMode(input.matchMode);
    const contextLines = Math.max(0, Math.floor(input.contextLines ?? 0));
    const matches = files.flatMap(([filePath, body]) => searchMemoryLines({
      caseSensitive: input.caseSensitive ?? true,
      contextLines,
      lines: body.split(/\r?\n/),
      mode,
      path: filePath,
      queries,
    }));
    const start = cursorIndex(input.cursor, matches.length);
    const limit = clampResultLimit(input.maxResults, DEFAULT_MEMORY_FILE_SEARCH_LIMIT);
    const end = Math.min(matches.length, start + limit);
    return {
      queries,
      matchMode: mode,
      path: input.path,
      matches: matches.slice(start, end),
      nextCursor: end < matches.length ? String(end) : null,
      truncated: end < matches.length,
    };
  }

  async recordMemoryCitationUsage(citation: RuntimeMemoryCitation): Promise<{ updated: number; rolloutIds: string[] }> {
    const rolloutIds = uniqueStrings(citation.rolloutIds);
    if (!rolloutIds.length) return { updated: 0, rolloutIds };

    const now = this.clock.now().toISOString();
    let updated = 0;
    for (const root of await this.memoryStoreRoots()) {
      await withFileStateUpdate(this.memoryPath(root), async () => {
        const index = await this.readIndex(root);
        let changed = false;
        const memories = index.memories.map((memory) => {
          if (isInactiveMemory(memory) || !memoryMatchesRolloutIds(memory, rolloutIds)) return memory;
          changed = true;
          updated += 1;
          return {
            ...memory,
            usageCount: normalizedUsageCount(memory.usageCount) + 1,
            lastUsedAt: now,
          };
        });
        const stage1Outputs = normalizeStage1Outputs(index.stage1Outputs).map((output) => {
          if (!isRenderableStage1Output(output) || !stage1OutputMatchesRolloutIds(output, rolloutIds)) return output;
          changed = true;
          updated += 1;
          return {
            ...output,
            usageCount: normalizedUsageCount(output.usageCount) + 1,
            lastUsedAt: now,
            updatedAt: now,
          };
        });
        if (changed) await this.writeIndex({ ...index, memories, stage1Outputs }, root);
      });
    }

    return { updated, rolloutIds };
  }

  async listStage1Outputs(): Promise<RuntimeMemoryStage1OutputList> {
    const outputs: RuntimeMemoryStage1Output[] = [];
    const seen = new Set<string>();
    for (const root of await this.memoryStoreRoots()) {
      const index = await this.readIndex(root);
      for (const output of normalizeStage1Outputs(index.stage1Outputs)) {
        if (isInactiveStage1Output(output)) continue;
        const id = output.id || stage1OutputDedupeKey(output);
        if (seen.has(id)) continue;
        seen.add(id);
        outputs.push(stage1OutputForRead(output));
      }
    }
    outputs.sort((left, right) => right.sourceUpdatedAt.localeCompare(left.sourceUpdatedAt));
    return { outputs };
  }

  async recordStage1Output(input: CreateRuntimeMemoryStage1OutputInput): Promise<RuntimeMemoryStage1Output> {
    const threadId = optionalText(input.threadId);
    if (!threadId) throw new Error('Stage-1 output requires threadId.');
    const status = normalizeStage1Status(input.status);
    const rawMemory = compactMultilineText(input.rawMemory, MAX_STAGE1_RAW_MEMORY_CHARS);
    const rolloutSummary = compactMultilineText(input.rolloutSummary, MAX_STAGE1_ROLLOUT_SUMMARY_CHARS);
    if (status === 'succeeded' && (!rawMemory || !rolloutSummary)) throw new Error('Successful stage-1 output requires rawMemory and rolloutSummary.');

    const now = this.clock.now().toISOString();
    const output: RuntimeMemoryStage1Output = {
      id: this.ids.id('stage1'),
      threadId,
      turnId: optionalText(input.turnId),
      status,
      sourceUpdatedAt: validIsoDate(input.sourceUpdatedAt) ?? now,
      rawMemory: status === 'succeeded' ? rawMemory : '',
      rolloutSummary: status === 'succeeded' ? rolloutSummary : '',
      rolloutSlug: status === 'succeeded' ? optionalText(input.rolloutSlug, MAX_STAGE1_ROLLOUT_SLUG_CHARS) : undefined,
      rolloutPath: optionalText(input.rolloutPath),
      cwd: optionalText(input.cwd),
      projectId: optionalText(input.projectId),
      failureReason: status === 'failed' ? optionalText(input.failureReason, MAX_STAGE1_FAILURE_REASON_CHARS) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    const root = await this.activeMemoryRoot();
    return withFileStateUpdate(this.memoryPath(root), async () => {
      const index = await this.readIndex(root);
      const existingOutputs = normalizeStage1Outputs(index.stage1Outputs);
      const existingIndex = existingOutputs.findIndex((item) => !isInactiveStage1Output(item) && stage1OutputDedupeKey(item) === stage1OutputDedupeKey(output));
      if (existingIndex >= 0) {
        const existing = existingOutputs[existingIndex];
        const updated = {
          ...existing,
          ...output,
          id: existing.id || output.id,
          createdAt: existing.createdAt || output.createdAt,
          usageCount: existing.usageCount,
          lastUsedAt: existing.lastUsedAt,
        };
        existingOutputs[existingIndex] = updated;
        await this.writeIndex({ ...index, stage1Outputs: existingOutputs }, root);
        return stage1OutputForRead(updated);
      }
      const stage1Outputs = [output, ...existingOutputs];
      await this.writeIndex({ ...index, stage1Outputs }, root);
      return output;
    });
  }

  async claimPhase2Job(input: { ownerId: string; leaseSeconds: number; retryDelaySeconds: number }): Promise<RuntimeMemoryPhase2JobClaim> {
    const ownerId = optionalText(input.ownerId) ?? 'runtime';
    const root = await this.activeMemoryRoot();
    return withFileStateUpdate(this.memoryPath(root), async () => {
      const index = await this.readIndex(root);
      const nowMs = this.clock.now().getTime();
      const phase2Job = normalizePhase2Job(index.phase2Job);
      const inputWatermark = phase2InputWatermark(index.stage1Outputs);
      const completedWatermark = normalizedWatermark(phase2Job.completedWatermark);

      if (inputWatermark <= completedWatermark) return { status: 'skipped_no_input', inputWatermark };
      if (phase2Job.status === 'running' && futureTimestampMs(phase2Job.leaseExpiresAt, nowMs)) return { status: 'skipped_running', inputWatermark };
      if (futureTimestampMs(phase2Job.retryAfter, nowMs)) return { status: 'skipped_cooldown', inputWatermark };

      const now = new Date(nowMs).toISOString();
      const ownershipToken = this.ids.id('phase2');
      const nextJob: StoredMemoryPhase2Job = {
        status: 'running', ownerId, ownershipToken, inputWatermark, completedWatermark,
        leaseExpiresAt: new Date(nowMs + Math.max(1, Math.floor(input.leaseSeconds)) * 1000).toISOString(),
        createdAt: phase2Job.createdAt ?? now, updatedAt: now,
      };
      await this.writeIndex({ ...index, phase2Job: nextJob }, root);
      return { status: 'claimed', ownershipToken, inputWatermark };
    });
  }

  async heartbeatPhase2Job(input: { ownershipToken: string; leaseSeconds: number }): Promise<boolean> {
    const root = await this.activeMemoryRoot();
    return withFileStateUpdate(this.memoryPath(root), async () => {
      const index = await this.readIndex(root);
      const phase2Job = normalizePhase2Job(index.phase2Job);
      const nowMs = this.clock.now().getTime();
      if (phase2Job.status !== 'running' || phase2Job.ownershipToken !== input.ownershipToken || !futureTimestampMs(phase2Job.leaseExpiresAt, nowMs)) return false;
      const now = new Date(nowMs).toISOString();
      await this.writeIndex({
        ...index,
        phase2Job: {
          ...phase2Job,
          leaseExpiresAt: new Date(nowMs + Math.max(1, Math.floor(input.leaseSeconds)) * 1000).toISOString(),
          updatedAt: now,
        },
      }, root);
      return true;
    });
  }

  async markPhase2JobSucceeded(input: { ownershipToken: string; completionWatermark: number }): Promise<boolean> {
    const root = await this.activeMemoryRoot();
    return withFileStateUpdate(this.memoryPath(root), async () => {
      const index = await this.readIndex(root);
      const phase2Job = normalizePhase2Job(index.phase2Job);
      if (phase2Job.status !== 'running' || phase2Job.ownershipToken !== input.ownershipToken) return false;
      const now = this.clock.now().toISOString();
      await this.writeIndex({
        ...index,
        phase2Job: {
          status: 'succeeded',
          inputWatermark: phase2Job.inputWatermark,
          completedWatermark: Math.max(normalizedWatermark(input.completionWatermark), normalizedWatermark(phase2Job.inputWatermark)),
          createdAt: phase2Job.createdAt ?? now,
          updatedAt: now,
        },
      }, root);
      return true;
    });
  }

  async markPhase2JobFailed(input: { ownershipToken: string; reason: string; retryDelaySeconds: number }): Promise<boolean> {
    const root = await this.activeMemoryRoot();
    return withFileStateUpdate(this.memoryPath(root), async () => {
      const index = await this.readIndex(root);
      const phase2Job = normalizePhase2Job(index.phase2Job);
      if (phase2Job.status !== 'running' || phase2Job.ownershipToken !== input.ownershipToken) return false;
      const nowMs = this.clock.now().getTime();
      const now = new Date(nowMs).toISOString();
      await this.writeIndex({
        ...index,
        phase2Job: {
          ...phase2Job,
          status: 'failed',
          ownershipToken: undefined,
          leaseExpiresAt: undefined,
          retryAfter: new Date(nowMs + Math.max(1, Math.floor(input.retryDelaySeconds)) * 1000).toISOString(),
          lastFailureReason: optionalText(input.reason, MAX_PHASE2_FAILURE_REASON_CHARS),
          updatedAt: now,
        },
      }, root);
      return true;
    });
  }

  async preparePhase2Workspace(): Promise<RuntimeMemoryPhase2Workspace> {
    return prepareMemoryPhase2Workspace(await this.activeMemoryRoot());
  }

  async syncPhase2Workspace(): Promise<RuntimeMemoryPhase2Workspace> {
    const root = await this.activeMemoryRoot();
    await this.writeMemoryArtifacts(renderMemoryArtifacts(await this.readIndex(root)), root);
    return syncMemoryPhase2Workspace(root);
  }

  async resetPhase2WorkspaceBaseline(): Promise<RuntimeMemoryPhase2Workspace> {
    return resetMemoryPhase2WorkspaceBaseline(await this.activeMemoryRoot());
  }

  async previewMemories(): Promise<RuntimeMemoryPreview> {
    const roots = await this.memoryStoreRoots();
    const entries = await this.readMergedMemoryEntries(roots);
    const items = entries
      .map((entry) => memoryPreviewItem(entry.memory, entry.root))
      .filter((item): item is RuntimeMemoryPreviewItem => Boolean(item))
      .sort((left, right) => memoryPreviewSortKey(right).localeCompare(memoryPreviewSortKey(left)))
      .slice(0, MEMORY_PREVIEW_MAX_ITEMS);

    return {
      storagePath: roots[0] ?? this.dataDir,
      total: items.length,
      items,
    };
  }

  async rememberMemory(input: CreateRuntimeMemoryInput): Promise<RuntimeMemoryRecord> {
    const content = compactText(input.content, MAX_MEMORY_CONTENT_CHARS);
    if (!content) throw new Error('Memory content is required.');
    const scope: RuntimeMemoryScope = input.scope ?? (input.projectId ? 'project' : 'global');
    if (scope === 'project' && !input.projectId) throw new Error('Project memory requires projectId.');

    const now = this.clock.now().toISOString();
    const memory: RuntimeMemoryRecord = {
      id: this.ids.id('mem'),
      scope,
      projectId: scope === 'project' ? input.projectId : undefined,
      content,
      kind: normalizeMemoryKind(input.kind),
      origin: input.origin === 'passive' ? 'passive' : 'active',
      source: optionalText(input.source, MAX_MEMORY_SOURCE_CHARS),
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      title: memoryTitle(input.title, content),
      tags: normalizeTags(input.tags),
      workspaceRoot: optionalText(input.workspaceRoot),
      createdAt: now,
      updatedAt: now,
    };
    const root = await this.activeMemoryRoot();
    return withFileStateUpdate(this.memoryPath(root), async () => {
      const index = await this.readIndex(root);
      const existing = index.memories.find((item) => !isInactiveMemory(item) && memoryDedupeKey(item) === memoryDedupeKey(memory));
      if (existing) return { ...existing, kind: normalizeMemoryKind(existing.kind) };
      await this.writeIndex({
        ...index,
        memories: [memory, ...index.memories],
      }, root);
      return memory;
    });
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await Promise.all(
      (await this.memoryStoreRoots()).map(async (root) => {
        await withFileStateUpdate(this.memoryPath(root), async () => {
          const index = await this.readIndex(root);
          const memories = index.memories.filter((memory) => memory.id !== memoryId);
          if (memories.length === index.memories.length) return;
          await this.writeIndex({ ...index, memories }, root);
        });
      }),
    );
  }

  async clearMemories(): Promise<void> {
    await Promise.all((await this.memoryStoreRoots()).map((root) =>
      withFileStateUpdate(this.memoryPath(root), () => clearMemoryRootContents(root)),
    ));
  }

  private async readMergedMemoryEntries(roots?: string[]): Promise<Array<{ memory: StoredMemoryRecord; root: string; sourceLocation?: RuntimeMemorySourceLocation }>> {
    const entries: Array<{ memory: StoredMemoryRecord; root: string; sourceLocation?: RuntimeMemorySourceLocation }> = [];
    const seen = new Set<string>();
    for (const root of roots ?? await this.memoryStoreRoots()) {
      const index = await this.readIndex(root);
      for (const memory of index.memories) {
        const id = typeof memory.id === 'string' && memory.id ? memory.id : `${root}:${entries.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push({ memory, root });
      }
    }
    const merged = await this.mergedMemoryArtifacts(entries);
    return entries.map((entry) => ({
      ...entry,
      sourceLocation: entry.memory.id ? merged.locations.get(entry.memory.id) : undefined,
    }));
  }

  private async readIndex(root: string): Promise<MemoryIndex> {
    return normalizeMemoryIndex(await readJsonFile<MemoryIndex>(this.memoryPath(root), { version: 1, memories: [] }));
  }

  private async writeIndex(index: MemoryIndex, root: string): Promise<void> {
    const cleanIndex = {
      version: 1 as const,
      memories: index.memories.map(storedMemoryForWrite),
      stage1Outputs: normalizeStage1Outputs(index.stage1Outputs).map(storedStage1OutputForWrite),
      phase2Job: storedPhase2JobForWrite(index.phase2Job),
    };
    await writeJsonFile(this.memoryPath(root), cleanIndex);
    await this.writeMemoryArtifacts(renderMemoryArtifacts(cleanIndex), root);
  }

  private async memoryStoreRoots(): Promise<string[]> {
    const roots: string[] = [];
    const addRoot = (value: string | null | undefined) => {
      const text = normalizeStorageRoot(value);
      if (!text) return;
      const resolved = path.resolve(text);
      if (!roots.includes(resolved)) roots.push(resolved);
    };
    addRoot(await this.resolvedStorageRoot());
    addRoot(this.defaultMemoryRoot());
    return roots;
  }

  private async activeMemoryRoot(): Promise<string> {
    return path.resolve(normalizeStorageRoot(await this.resolvedStorageRoot()) || this.defaultMemoryRoot());
  }

  private async resolvedStorageRoot(): Promise<string | null | undefined> {
    if (!this.storageRootResolver) return undefined;
    return this.storageRootResolver();
  }

  private memoryPath(root: string): string {
    return path.join(root, MEMORY_FILE_NAME);
  }

  private defaultMemoryRoot(): string {
    return path.join(this.dataDir, DEFAULT_MEMORY_DIR_NAME);
  }

  private async writeMemoryArtifacts(artifacts: RenderedMemoryArtifacts, root: string): Promise<void> {
    await mkdir(path.join(root, ROLLOUT_SUMMARIES_DIR_NAME), { recursive: true });
    await Promise.all([...artifacts.files].map(async ([relativePath, content]) => {
      if (await shouldPreserveExistingArtifact(root, relativePath)) return;
      const target = path.join(root, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }));
    await this.pruneRolloutSummaries(root, artifacts);
  }

  private async pruneRolloutSummaries(root: string, artifacts: RenderedMemoryArtifacts): Promise<void> {
    const dir = path.join(root, ROLLOUT_SUMMARIES_DIR_NAME);
    const keep = new Set([...artifacts.files.keys()].filter((filePath) => filePath.startsWith(`${ROLLOUT_SUMMARIES_DIR_NAME}/`)).map((filePath) => path.basename(filePath)));
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    await Promise.all(entries.map(async (fileName) => {
      if (!fileName.endsWith('.md') || keep.has(fileName)) return;
      await rm(path.join(dir, fileName), { force: true });
    }));
  }

  private async mergedMemoryArtifacts(entries?: Array<{ memory: StoredMemoryRecord; root: string }>): Promise<RenderedMemoryArtifacts> {
    const mergedIndex = entries
      ? { version: 1 as const, memories: entries.map((entry) => entry.memory), stage1Outputs: await this.readMergedStage1Outputs() }
      : await this.readMergedMemoryIndexWithoutLocations();
    const artifacts = renderMemoryArtifacts(mergedIndex);
    const root = await this.activeMemoryRoot();
    // Read APIs render a merged in-memory view. Persisted artifacts are only
    // refreshed by mutations so a stale reader cannot overwrite newer output.
    return overlayStoredMemoryArtifacts(artifacts, root);
  }

  private async readMergedMemoryIndexWithoutLocations(): Promise<MemoryIndex> {
    const entries: Array<{ memory: StoredMemoryRecord; root: string }> = [];
    const stage1Outputs: StoredMemoryStage1Output[] = [];
    const seen = new Set<string>();
    const seenStage1 = new Set<string>();
    for (const root of await this.memoryStoreRoots()) {
      const index = await this.readIndex(root);
      for (const memory of index.memories) {
        const id = typeof memory.id === 'string' && memory.id ? memory.id : `${root}:${entries.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push({ memory, root });
      }
      for (const output of normalizeStage1Outputs(index.stage1Outputs)) {
        const key = output.id || stage1OutputDedupeKey(output);
        if (seenStage1.has(key)) continue;
        seenStage1.add(key);
        stage1Outputs.push(output);
      }
    }
    return { version: 1, memories: entries.map((entry) => entry.memory), stage1Outputs };
  }

  private async readMergedStage1Outputs(): Promise<StoredMemoryStage1Output[]> {
    return (await this.readMergedMemoryIndexWithoutLocations()).stage1Outputs ?? [];
  }
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MEMORY_LIMIT;
  return Math.max(1, Math.min(MAX_MEMORY_LIMIT, Math.floor(value)));
}

function clampResultLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_MEMORY_FILE_RESULTS, Math.floor(value)));
}

function cursorIndex(value: unknown, max: number): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error('Invalid memory file cursor.');
  return parsed;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Expected a positive integer.');
  return parsed;
}

function normalizeMemoryFilePath(value: unknown): string | undefined {
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

function normalizeRequiredMemoryFilePath(value: unknown): string {
  const text = normalizeMemoryFilePath(value);
  if (!text) throw new Error('Memory file path is required.');
  return text;
}

function normalizeStorageRoot(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMemoryIndex(value: MemoryIndex): MemoryIndex {
  return {
    version: 1,
    memories: Array.isArray(value.memories) ? value.memories : [],
    stage1Outputs: normalizeStage1Outputs(value.stage1Outputs),
    phase2Job: normalizePhase2Job(value.phase2Job),
  };
}

function normalizeStage1Outputs(value: unknown): StoredMemoryStage1Output[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is StoredMemoryStage1Output => Boolean(item && typeof item === 'object'))
        .map((item) => ({ ...item, status: normalizeStage1Status(item.status) }))
    : [];
}

function normalizePhase2Job(value: unknown): StoredMemoryPhase2Job {
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

async function clearMemoryRootContents(root: string): Promise<void> {
  try {
    const stats = await lstat(root);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to clear symlinked memory root: ${root}`);
    }
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }

  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(entries.map((entry) => rm(path.join(root, entry.name), { recursive: true, force: true })));
}

async function shouldPreserveExistingArtifact(root: string, relativePath: string): Promise<boolean> {
  if (relativePath !== MEMORY_MARKDOWN_FILE_NAME && relativePath !== MEMORY_SUMMARY_FILE_NAME) return false;
  const target = path.join(root, relativePath);
  let content = '';
  try {
    content = await readFile(target, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
  // Phase-2 writes become the durable source of truth. Generated fallbacks keep the marker and
  // may be refreshed from memories.json until the first real consolidation succeeds.
  return !content.includes('Generated from memories.json.');
}

async function overlayStoredMemoryArtifacts(artifacts: RenderedMemoryArtifacts, root: string): Promise<RenderedMemoryArtifacts> {
  const files = new Map(artifacts.files);
  await overlayStoredFile(files, root, MEMORY_MARKDOWN_FILE_NAME);
  await overlayStoredFile(files, root, MEMORY_SUMMARY_FILE_NAME);
  await overlayStoredDirectory(files, root, SKILLS_DIR_NAME);
  return {
    ...artifacts,
    files,
  };
}

async function overlayStoredFile(files: Map<string, string>, root: string, relativePath: string): Promise<void> {
  try {
    files.set(relativePath, await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }
}

async function overlayStoredDirectory(files: Map<string, string>, root: string, relativeDir: string): Promise<void> {
  const dir = path.join(root, relativeDir);
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function optionalText(value: unknown, maxChars?: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = compactText(value, maxChars);
  return text || undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
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

function normalizeMemoryKind(value: unknown): RuntimeMemoryKind {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return MEMORY_KINDS.has(kind as RuntimeMemoryKind) ? kind as RuntimeMemoryKind : 'note';
}

function memoryTitle(value: unknown, content: string): string | undefined {
  return optionalText(value, MAX_MEMORY_TITLE_CHARS) ?? firstMemoryLine(content);
}

function compactText(value: unknown, maxChars: number | undefined): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!maxChars || text.length <= maxChars) return text;
  return Array.from(text).slice(0, maxChars).join('');
}

function compactMultilineText(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (text.length <= maxChars) return text;
  return Array.from(text).slice(0, maxChars).join('').trimEnd();
}

function validIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function memoryDedupeKey(memory: Pick<RuntimeMemoryRecord, 'scope' | 'projectId' | 'workspaceRoot' | 'content'> & { kind?: unknown }): string {
  return [
    memory.scope === 'project' ? 'project' : 'global',
    normalizeMemoryKind(memory.kind),
    compactText(memory.content, undefined).toLowerCase(),
    memory.scope === 'project' ? path.resolve(String(memory.workspaceRoot || memory.projectId || '')) : '',
  ].join('\0');
}

function memoryWithSourceLocation(memory: StoredMemoryRecord, sourceLocation: RuntimeMemorySourceLocation | undefined): RuntimeMemoryRecord {
  return {
    ...memory,
    kind: normalizeMemoryKind(memory.kind),
    sourceLocation,
  };
}

function storedMemoryForWrite(memory: StoredMemoryRecord): StoredMemoryRecord {
  const { sourceLocation: _sourceLocation, ...persisted } = memory;
  return persisted;
}

function storedStage1OutputForWrite(output: StoredMemoryStage1Output): StoredMemoryStage1Output {
  return { ...output, status: normalizeStage1Status(output.status) };
}

function storedPhase2JobForWrite(value: unknown): StoredMemoryPhase2Job | undefined {
  const job = normalizePhase2Job(value);
  return job.status ? job : undefined;
}

function stage1OutputForRead(output: StoredMemoryStage1Output): RuntimeMemoryStage1Output {
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

function memoryMatchesRolloutIds(memory: StoredMemoryRecord, rolloutIds: string[]): boolean {
  const ids = new Set(rolloutIds);
  return Boolean(
    (memory.sourceThreadId && ids.has(memory.sourceThreadId))
    || (memory.id && ids.has(memory.id))
  );
}

function stage1OutputDedupeKey(output: Pick<StoredMemoryStage1Output, 'threadId' | 'turnId'>): string {
  return `${output.threadId}\0${output.turnId ?? ''}`;
}

function stage1OutputMatchesRolloutIds(output: StoredMemoryStage1Output, rolloutIds: string[]): boolean {
  const ids = new Set(rolloutIds);
  return Boolean(
    (output.threadId && ids.has(output.threadId))
    || (output.id && ids.has(output.id))
  );
}

function normalizedUsageCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
}

function isInactiveMemory(memory: StoredMemoryRecord): boolean {
  return memory.status === 'archived' || memory.status === 'deleted';
}

function isInactiveStage1Output(output: StoredMemoryStage1Output): boolean {
  return output.status === 'archived' || output.status === 'deleted';
}

function isRenderableStage1Output(output: StoredMemoryStage1Output): boolean {
  return !isInactiveStage1Output(output)
    && normalizeStage1Status(output.status) === 'succeeded'
    && Boolean(String(output.rawMemory || '').trim())
    && Boolean(String(output.rolloutSummary || '').trim());
}

function normalizeStage1Status(value: unknown): RuntimeMemoryStage1Status {
  return value === 'succeeded_no_output' || value === 'failed' ? value : 'succeeded';
}

function phase2InputWatermark(outputs: unknown): number {
  return normalizeStage1Outputs(outputs)
    .filter(isRenderableStage1Output)
    .map((output) => Date.parse(output.sourceUpdatedAt))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, Math.floor(value / 1000)), 0);
}

function normalizedWatermark(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function futureTimestampMs(value: unknown, nowMs: number): boolean {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && timestamp > nowMs;
}

function memoryPreviewItem(memory: StoredMemoryRecord, root: string): RuntimeMemoryPreviewItem | null {
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

function firstMemoryLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 80) ?? '';
}

function memoryPreviewSnippet(value: string): string {
  return Array.from(value.trim()).slice(0, MEMORY_PREVIEW_SNIPPET_CHARS).join('');
}

function memoryPreviewSortKey(item: RuntimeMemoryPreviewItem): string {
  return `${item.updatedAt}\0${item.title}\0${item.id}`;
}

type RenderedMemoryArtifacts = {
  files: Map<string, string>;
  locations: Map<string, RuntimeMemorySourceLocation>;
};

function renderMemoryArtifacts(index: MemoryIndex): RenderedMemoryArtifacts {
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

type RenderedMemoryMarkdown = {
  body: string;
  locations: Map<string, RuntimeMemorySourceLocation>;
};

function renderMemoryMarkdown(index: MemoryIndex): RenderedMemoryMarkdown {
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

function markdownHeadingText(value: string): string {
  return compactText(value, MAX_MEMORY_TITLE_CHARS).replace(/^[#\s]+/, '') || '记忆';
}

function markdownMemoryContent(value: string): string[] {
  const lines = String(value).trim().split(/\r?\n/).map((line) => line.trimEnd());
  return lines.length ? lines : [''];
}

function renderMemorySummary(index: MemoryIndex): string {
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

function renderRawMemories(index: MemoryIndex): string {
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

function renderRolloutSummaries(index: MemoryIndex): Map<string, string> {
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

function memoryFileEntries(artifacts: RenderedMemoryArtifacts, requestedPath: string | undefined): RuntimeMemoryFileList['entries'] | null {
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

function memorySearchFiles(artifacts: RenderedMemoryArtifacts, requestedPath: string | undefined): Array<[string, string]> {
  const files = [...artifacts.files.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (!requestedPath) return files;
  const content = artifacts.files.get(requestedPath);
  if (content !== undefined) return [[requestedPath, content]];
  const prefix = `${requestedPath}/`;
  return files.filter(([filePath]) => filePath.startsWith(prefix));
}

function memoryFileEntrySort(left: RuntimeMemoryFileList['entries'][number], right: RuntimeMemoryFileList['entries'][number]): number {
  const leftPriority = rootMemoryEntryPriority(left.path);
  const rightPriority = rootMemoryEntryPriority(right.path);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.path.localeCompare(right.path);
}

function rootMemoryEntryPriority(filePath: string): number {
  if (filePath === MEMORY_MARKDOWN_FILE_NAME) return 0;
  if (filePath === MEMORY_SUMMARY_FILE_NAME) return 1;
  if (filePath === RAW_MEMORIES_FILE_NAME) return 2;
  if (filePath === ROLLOUT_SUMMARIES_DIR_NAME) return 3;
  if (filePath === SKILLS_DIR_NAME) return 4;
  return 10;
}

function memoryKindLabel(kind: RuntimeMemoryKind): string {
  if (kind === 'project_rule') return 'Project Rules';
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1).replaceAll('_', ' ')}s`;
}

function rolloutSummaryKey(memory: StoredMemoryRecord): string {
  return memory.sourceThreadId || memory.id || memory.content;
}

function rolloutSummaryFileName(memory: StoredMemoryRecord): string {
  return `${safeArtifactStem(rolloutSummaryKey(memory))}.md`;
}

function stage1RolloutSummaryFileName(output: StoredMemoryStage1Output): string {
  const slug = stage1RolloutSlugFilePart(output.rolloutSlug);
  return `${stage1FileTimestamp(output.sourceUpdatedAt)}-${stage1ThreadShortHash(output.threadId)}${slug ? `-${slug}` : ''}.md`;
}

function stage1RawMemorySort(left: StoredMemoryStage1Output, right: StoredMemoryStage1Output): number {
  return String(left.threadId || '').localeCompare(String(right.threadId || ''))
    || String(left.sourceUpdatedAt || '').localeCompare(String(right.sourceUpdatedAt || ''));
}

function safeArtifactStem(value: string): string {
  const text = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return text || 'memory';
}

function stage1FileTimestamp(value: unknown): string {
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

function stage1ThreadShortHash(value: unknown): string {
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

function stage1RolloutSlugFilePart(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let slug = '';
  for (const char of raw) {
    if (slug.length >= 60) break;
    slug += /[a-zA-Z0-9]/.test(char) ? char.toLowerCase() : '_';
  }
  return slug.replace(/_+$/g, '').replace(/^_+/g, '');
}

function normalizeSearchMatchMode(value: RuntimeMemorySearchMatchMode | undefined): RuntimeMemorySearchMatchMode {
  if (value === 'all_on_same_line' || value === 'any') return value;
  if (value && typeof value === 'object' && value.type === 'all_within_lines') {
    return { type: 'all_within_lines', lineCount: Math.max(1, Math.floor(value.lineCount)) };
  }
  return 'any';
}

function searchMemoryLines(input: {
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

function memorySearchMatch(
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

function matchedQueries(queries: string[], flags: boolean[]): string[] {
  return queries.filter((_query, index) => flags[index]);
}
