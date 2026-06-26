import path from 'node:path';
import type {
  CreateRuntimeMemoryInput,
  RuntimeMemoryList,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
  RuntimeMemoryScope,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

type MemoryIndex = {
  version: 1;
  memories: RuntimeMemoryRecord[];
};

const DEFAULT_MEMORY_LIMIT = 50;
const MAX_MEMORY_LIMIT = 500;

export class FileMemoryStore implements MemoryStore {
  private readonly memoryPath: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.memoryPath = path.join(dataDir, 'memories.json');
  }

  async listMemories(query: RuntimeMemoryQuery = {}): Promise<RuntimeMemoryList> {
    const index = await this.readIndex();
    const search = query.search?.trim().toLowerCase();
    const memories = index.memories
      .filter((memory) => !query.scope || memory.scope === query.scope)
      .filter((memory) => !query.projectId || memory.scope === 'global' || memory.projectId === query.projectId)
      .filter((memory) => !search || memory.content.toLowerCase().includes(search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, clampLimit(query.limit));
    return { memories };
  }

  async rememberMemory(input: CreateRuntimeMemoryInput): Promise<RuntimeMemoryRecord> {
    const content = input.content.trim();
    if (!content) throw new Error('Memory content is required.');
    const scope: RuntimeMemoryScope = input.scope ?? (input.projectId ? 'project' : 'global');
    if (scope === 'project' && !input.projectId) throw new Error('Project memory requires projectId.');

    const now = this.clock.now().toISOString();
    const index = await this.readIndex();
    const memory: RuntimeMemoryRecord = {
      id: this.ids.id('mem'),
      scope,
      projectId: scope === 'project' ? input.projectId : undefined,
      content,
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeIndex({
      ...index,
      memories: [memory, ...index.memories],
    });
    return memory;
  }

  async deleteMemory(memoryId: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex({
      ...index,
      memories: index.memories.filter((memory) => memory.id !== memoryId),
    });
  }

  private async readIndex(): Promise<MemoryIndex> {
    return readJsonFile<MemoryIndex>(this.memoryPath, { version: 1, memories: [] });
  }

  private async writeIndex(index: MemoryIndex): Promise<void> {
    await writeJsonFile(this.memoryPath, index);
  }
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MEMORY_LIMIT;
  return Math.max(1, Math.min(MAX_MEMORY_LIMIT, Math.floor(value)));
}
