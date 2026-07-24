import type {
  CreateRuntimeMemoryInput,
  CreateRuntimeMemoryStage1OutputInput,
  RuntimeMemoryCitation,
  RuntimeMemoryFileList,
  RuntimeMemoryFileRead,
  RuntimeMemoryFileReadInput,
  RuntimeMemoryFileSearch,
  RuntimeMemoryFileSearchInput,
  RuntimeMemoryList,
  RuntimeMemoryPhase2JobClaim,
  RuntimeMemoryPhase2Workspace,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
  RuntimeMemoryScope,
  RuntimeMemorySourceLocation,
  RuntimeMemoryStage1Output,
  RuntimeMemoryStage1OutputList
} from '@setsuna-desktop/contracts';
import {
  mkdir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import { resolveConfinedPathWithoutSymlinks } from '../../security/path-confinement.js';
import type {
  MemoryIndex,
  RenderedMemoryArtifacts,
  StoredMemoryPhase2Job,
  StoredMemoryRecord,
  StoredMemoryStage1Output
} from './file-memory-store-model.js';
import {
  DEFAULT_MEMORY_FILE_LIST_LIMIT,
  DEFAULT_MEMORY_FILE_SEARCH_LIMIT,
  MAX_MEMORY_CONTENT_CHARS,
  MAX_MEMORY_SOURCE_CHARS,
  MAX_PHASE2_FAILURE_REASON_CHARS,
  MAX_STAGE1_FAILURE_REASON_CHARS,
  MAX_STAGE1_RAW_MEMORY_CHARS,
  MAX_STAGE1_ROLLOUT_SLUG_CHARS,
  MAX_STAGE1_ROLLOUT_SUMMARY_CHARS,
  MEMORY_FILE_NAME,
  MEMORY_PREVIEW_MAX_ITEMS,
  ROLLOUT_SUMMARIES_DIR_NAME,
  clampLimit,
  clampResultLimit,
  compactMultilineText,
  compactText,
  cursorIndex,
  futureTimestampMs,
  isInactiveMemory,
  isInactiveStage1Output,
  isRenderableStage1Output,
  memoryDedupeKey,
  memoryFileEntries,
  memoryMatchesRolloutIds,
  memoryPreviewItem,
  memoryPreviewSortKey,
  memorySearchFiles,
  memoryTitle,
  memoryWithSourceLocation,
  normalizeMemoryFilePath,
  normalizeMemoryIndex,
  normalizeMemoryKind,
  normalizePhase2Job,
  normalizeRequiredMemoryFilePath,
  normalizeSearchMatchMode,
  normalizeStage1Outputs,
  normalizeStage1Status,
  normalizeTags,
  normalizedUsageCount,
  normalizedWatermark,
  optionalText,
  overlayStoredMemoryArtifacts,
  phase2InputWatermark,
  positiveInteger,
  renderMemoryArtifacts,
  searchMemoryLines,
  shouldPreserveExistingArtifact,
  stage1OutputDedupeKey,
  stage1OutputForRead,
  stage1OutputMatchesRolloutIds,
  storedMemoryForWrite,
  storedPhase2JobForWrite,
  storedStage1OutputForWrite,
  uniqueStrings,
  validIsoDate
} from './file-memory-store-model.js';
import { withFileStateUpdate } from './file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from './json-file.js';
import {
  prepareMemoryPhase2Workspace,
  resetMemoryPhase2WorkspaceBaseline,
  syncMemoryPhase2Workspace,
} from './memory-phase2-workspace.js';
import { MemoryStorageRootManager } from './memory-storage-root.js';

export class FileMemoryStore implements MemoryStore {
  private readonly storageRoots: MemoryStorageRootManager;

  constructor(
    private readonly dataDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.storageRoots = new MemoryStorageRootManager(dataDir);
  }

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
      withFileStateUpdate(this.memoryPath(root), () => this.storageRoots.clear(root)),
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
    const memoryPath = await resolveConfinedPathWithoutSymlinks(root, this.memoryPath(root), { label: 'Memory index' });
    return normalizeMemoryIndex(await readJsonFile<MemoryIndex>(memoryPath, { version: 1, memories: [] }));
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
    return this.storageRoots.allRoots();
  }

  private async activeMemoryRoot(): Promise<string> {
    return this.storageRoots.activeRoot();
  }

  private memoryPath(root: string): string {
    return path.join(root, MEMORY_FILE_NAME);
  }

  private async writeMemoryArtifacts(artifacts: RenderedMemoryArtifacts, root: string): Promise<void> {
    await mkdir(path.join(root, ROLLOUT_SUMMARIES_DIR_NAME), { recursive: true });
    await Promise.all([...artifacts.files].map(async ([relativePath, content]) => {
      if (await shouldPreserveExistingArtifact(root, relativePath)) return;
      const target = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativePath), { label: 'Memory artifact' });
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }));
    await this.pruneRolloutSummaries(root, artifacts);
  }

  private async pruneRolloutSummaries(root: string, artifacts: RenderedMemoryArtifacts): Promise<void> {
    const dir = await resolveConfinedPathWithoutSymlinks(root, path.join(root, ROLLOUT_SUMMARIES_DIR_NAME), { label: 'Memory artifact' });
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
    // 读取 API 会呈现合并后的内存视图。只有修改操作才会刷新持久化产物，
    // 防止过期读取方覆盖较新的输出。
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
