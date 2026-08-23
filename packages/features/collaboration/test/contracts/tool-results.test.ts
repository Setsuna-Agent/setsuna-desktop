import { describe, expect, it } from 'vitest';
import { collaborationLegacySpawnResultCodec } from '../../src/contracts/index.js';

describe('legacy collaboration tool results', () => {
  it('upgrades the persisted flat spawn_agent result into the Feature payload', () => {
    expect(collaborationLegacySpawnResultCodec.parse({
      tool: 'spawn_agent',
      senderThreadId: 'thread_parent',
      childThreadId: 'thread_child',
      newThreadId: 'thread_child',
      taskId: 'task_1',
      turnId: 'turn_child',
      title: 'Repository scan',
      objective: 'Inspect the repository.',
      identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
      status: 'running',
    })).toEqual({
      childThreadId: 'thread_child',
      identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
      objective: 'Inspect the repository.',
      parentThreadId: 'thread_parent',
      status: 'running',
      taskId: 'task_1',
      title: 'Repository scan',
      turnId: 'turn_child',
    });
  });

  it('rejects unrelated flat tool results', () => {
    expect(() => collaborationLegacySpawnResultCodec.parse({
      tool: 'wait',
      senderThreadId: 'thread_parent',
    })).toThrow('not a spawn_agent result');
  });
});
