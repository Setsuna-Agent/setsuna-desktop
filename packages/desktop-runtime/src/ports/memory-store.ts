import type {
  CreateRuntimeMemoryInput,
  RuntimeMemoryList,
  RuntimeMemoryPreview,
  RuntimeMemoryQuery,
  RuntimeMemoryRecord,
} from '@setsuna-desktop/contracts';

export type MemoryStore = {
  listMemories(query?: RuntimeMemoryQuery): Promise<RuntimeMemoryList>;
  previewMemories(): Promise<RuntimeMemoryPreview>;
  rememberMemory(input: CreateRuntimeMemoryInput): Promise<RuntimeMemoryRecord>;
  deleteMemory(memoryId: string): Promise<void>;
  clearMemories(): Promise<void>;
};
