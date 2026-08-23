import {
  DEFAULT_MEMORY_PREFERENCES,
  applyMemoryPreferencesPatch,
  type MemoryPreferences,
  type MemoryPreferencesPatch,
} from '@setsuna-desktop/feature-memory/contracts';
import { RuntimeMemoryCoordinator } from '@setsuna-desktop/feature-memory/runtime';
import type { RuntimeFeatureSettingsDocumentHandle } from '@setsuna-desktop/feature-core/settings';
import { CompositeToolHost } from '../../../src/adapters/tool/composite-tool-host.js';
import { MemoryToolHost } from '../../../src/adapters/tool/memory-tool-host.js';
import { AgentLoop as RuntimeAgentLoop } from '../../../src/loop/core/agent-loop.js';
import type { AgentLoopOptions } from '../../../src/loop/core/agent-loop-options.js';

export type TestMemoryPreferencesSource = Readonly<{
  memoryPreferencesForTest: MemoryPreferences;
}>;

/** Activates the real Memory Feature control around the narrow Core host for integration tests. */
export class TestMemoryAgentLoop extends RuntimeAgentLoop {
  constructor(options: AgentLoopOptions) {
    const featureTools = options.toolHost instanceof MemoryToolHost
      ? options.toolHost
      : new MemoryToolHost();
    const toolHost = options.toolHost && options.toolHost !== featureTools
      ? new CompositeToolHost([featureTools, options.toolHost])
      : featureTools;
    super({ ...options, toolHost });

    const preferences = memoryPreferencesFromOptions(options);
    const control = new RuntimeMemoryCoordinator({
      host: this.memoryRuntimeHost(),
      settings: new InMemoryMemorySettings(preferences),
    });
    featureTools.bind(control);
    this.bindMemoryControl(control);
  }
}

class InMemoryMemorySettings implements RuntimeFeatureSettingsDocumentHandle<
  MemoryPreferences,
  MemoryPreferences,
  MemoryPreferencesPatch,
  undefined
> {
  private revision = 1;
  private listeners = new Set<(state: { value: MemoryPreferences; revision: number }) => void>();

  constructor(private value: MemoryPreferences) {}

  async exists() { return true; }
  async initialize(input: Readonly<{ value: MemoryPreferences }>) {
    this.value = input.value;
    return this.snapshot();
  }
  async read() { return this.snapshot(); }
  async readPublic() { return this.snapshot(); }
  async readSecret() { return undefined; }
  async update(input: Readonly<{ expectedRevision: number; patch: MemoryPreferencesPatch }>) {
    if (input.expectedRevision !== this.revision) throw new Error('Test Memory settings revision conflict.');
    this.value = applyMemoryPreferencesPatch(this.value, input.patch);
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
  subscribeRuntime(listener: (state: { value: MemoryPreferences; revision: number }) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private snapshot() {
    return { value: this.value, revision: this.revision };
  }
}

function memoryPreferencesFromOptions(options: AgentLoopOptions): MemoryPreferences {
  const source = options.configStore as Partial<TestMemoryPreferencesSource> | undefined;
  return source?.memoryPreferencesForTest ?? DEFAULT_MEMORY_PREFERENCES;
}
