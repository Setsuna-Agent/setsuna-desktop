import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  clearMemory,
  deleteMemory,
  previewMemory,
  readMemorySettings,
  updateMemorySettings,
  type MemorySettingsState,
  type MemorySettingsUpdate,
  type RuntimeMemoryPreview,
} from '../contracts/index.js';

export type MemoryClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<MemorySettingsState>;
  updateSettings(input: MemorySettingsUpdate): Promise<MemorySettingsState>;
  preview(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeMemoryPreview>;
  delete(memoryId: string): Promise<void>;
  clear(): Promise<void>;
}>;

export function createMemoryClient(transport: FeatureOperationTransport): MemoryClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readMemorySettings, undefined, options),
    updateSettings: (input) => transport.call(updateMemorySettings, input),
    preview: (options) => transport.call(previewMemory, undefined, options),
    delete: async (memoryId) => {
      await transport.call(deleteMemory, { memoryId });
    },
    clear: async () => {
      await transport.call(clearMemory, undefined);
    },
  });
}
