import path from 'node:path';
import type {
  CreateRuntimeMemoryInput,
  RuntimeMemoryList,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
  RuntimeMemoryScope,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

type StoredMemoryRecord = RuntimeMemoryRecord & {
  kind?: string;
  status?: string;
};

type MemoryIndex = {
  version: 1;
  memories: StoredMemoryRecord[];
};

const DEFAULT_MEMORY_LIMIT = 50;
const MAX_MEMORY_LIMIT = 500;
const MEMORY_FILE_NAME = 'memories.json';
const MEMORY_PREVIEW_MAX_ITEMS = 500;
const MEMORY_PREVIEW_SNIPPET_CHARS = 1200;

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
      .map((entry) => entry.memory)
      .filter((memory) => !isInactiveMemory(memory))
      .filter((memory) => !query.scope || memory.scope === query.scope)
      .filter((memory) => !query.projectId || memory.scope === 'global' || memory.projectId === query.projectId)
      .filter((memory) => !search || memory.content.toLowerCase().includes(search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, clampLimit(query.limit));
    return { memories };
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
    const content = input.content.trim();
    if (!content) throw new Error('Memory content is required.');
    const scope: RuntimeMemoryScope = input.scope ?? (input.projectId ? 'project' : 'global');
    if (scope === 'project' && !input.projectId) throw new Error('Project memory requires projectId.');

    const now = this.clock.now().toISOString();
    const memory: RuntimeMemoryRecord = {
      id: this.ids.id('mem'),
      scope,
      projectId: scope === 'project' ? input.projectId : undefined,
      content,
      origin: input.origin === 'passive' ? 'passive' : 'active',
      source: optionalText(input.source),
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      title: optionalText(input.title),
      tags: normalizeTags(input.tags),
      workspaceRoot: optionalText(input.workspaceRoot),
      createdAt: now,
      updatedAt: now,
    };
    const root = await this.activeMemoryRoot();
    const index = await this.readIndex(root);
    await this.writeIndex({
      ...index,
      memories: [memory, ...index.memories],
    }, root);
    return memory;
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await Promise.all(
      (await this.memoryStoreRoots()).map(async (root) => {
        const index = await this.readIndex(root);
        const memories = index.memories.filter((memory) => memory.id !== memoryId);
        if (memories.length === index.memories.length) return;
        await this.writeIndex({ ...index, memories }, root);
      }),
    );
  }

  async clearMemories(): Promise<void> {
    const roots = await this.memoryStoreRoots();
    await Promise.all(
      roots.map(async (root, index) => {
        const current = await this.readIndex(root);
        if (!current.memories.length && index > 0) return;
        await this.writeIndex({ ...current, memories: [] }, root);
      }),
    );
  }

  private async readMergedMemoryEntries(roots?: string[]): Promise<Array<{ memory: StoredMemoryRecord; root: string }>> {
    const entries: Array<{ memory: StoredMemoryRecord; root: string }> = [];
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
    return entries;
  }

  private async readIndex(root: string): Promise<MemoryIndex> {
    return readJsonFile<MemoryIndex>(this.memoryPath(root), { version: 1, memories: [] });
  }

  private async writeIndex(index: MemoryIndex, root: string): Promise<void> {
    await writeJsonFile(this.memoryPath(root), { version: 1, memories: index.memories });
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
    addRoot(this.dataDir);
    return roots;
  }

  private async activeMemoryRoot(): Promise<string> {
    return path.resolve(normalizeStorageRoot(await this.resolvedStorageRoot()) || this.dataDir);
  }

  private async resolvedStorageRoot(): Promise<string | null | undefined> {
    if (!this.storageRootResolver) return undefined;
    return this.storageRootResolver();
  }

  private memoryPath(root: string): string {
    return path.join(root, MEMORY_FILE_NAME);
  }
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MEMORY_LIMIT;
  return Math.max(1, Math.min(MAX_MEMORY_LIMIT, Math.floor(value)));
}

function normalizeStorageRoot(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = [...new Set(value.map(optionalText).filter((tag): tag is string => Boolean(tag)))];
  return tags.length ? tags : undefined;
}

function isInactiveMemory(memory: StoredMemoryRecord): boolean {
  return memory.status === 'archived' || memory.status === 'deleted';
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
