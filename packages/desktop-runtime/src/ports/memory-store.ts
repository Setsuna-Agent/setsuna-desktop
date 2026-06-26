import type {
  CreateRuntimeMemoryInput,
  RuntimeMemoryList,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
} from '@setsuna-desktop/contracts';

export type MemoryStore = {
  listMemories(query?: RuntimeMemoryQuery): Promise<RuntimeMemoryList>;
  rememberMemory(input: CreateRuntimeMemoryInput): Promise<RuntimeMemoryRecord>;
  deleteMemory(memoryId: string): Promise<void>;
};
