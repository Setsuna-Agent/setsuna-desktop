import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { FileMemoryStore } from '../store/file-memory-store.js';
import { MemoryToolHost } from './memory-tool-host.js';

describe('memory tool host', () => {
  it('exposes remember and recall tools backed by local memory', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-tool-test-')), systemClock, new RandomIdGenerator());
    const host = new MemoryToolHost(store);
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const tools = await host.listTools(context);
    const saved = await host.runTool('remember_memory', { content: 'Use the memory port.', scope: 'global' }, context);
    const recalled = await host.runTool('recall_memory', { query: 'memory port' }, context);

    expect(tools.map((tool) => tool.name)).toEqual(['remember_memory', 'recall_memory']);
    expect(saved.content).toContain('Saved memory');
    expect(recalled.content).toContain('Use the memory port.');
  });
});
