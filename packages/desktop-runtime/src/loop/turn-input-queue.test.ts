import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { RuntimeTurnInputQueue } from './turn-input-queue.js';

describe('runtime turn input queue', () => {
  it('waits for in-flight writes before consumers drain steer messages', async () => {
    const queue = new RuntimeTurnInputQueue();
    const message = runtimeUserMessage('msg_1', 'interrupting update');
    let drained: ReturnType<RuntimeTurnInputQueue['takeSteers']> | null = null;

    queue.beginWrite();
    const drain = queue.waitForWrites().then(() => {
      drained = queue.takeSteers();
    });
    await Promise.resolve();
    expect(drained).toBeNull();

    queue.enqueueSteer({ message, skillIds: ['skill_1'], thinking: true, thinkingEffort: 'high' });
    queue.settleWrite();
    await drain;

    expect(drained).toEqual([{ message, skillIds: ['skill_1'], thinking: true, thinkingEffort: 'high' }]);
    expect(queue.takeSteers()).toEqual([]);
  });

  it('keeps mailbox input ordered but separate from steer consumption', () => {
    const queue = new RuntimeTurnInputQueue();
    const steer = runtimeUserMessage('msg_steer', 'new user input');

    queue.enqueueMailbox({ id: 'mail_1', fromAgentId: 'agent_1', content: 'agent update' });
    queue.enqueueSteer({ message: steer, skillIds: [] });

    expect(queue.hasPending()).toBe(true);
    expect(queue.takeSteers()).toEqual([{ message: steer, skillIds: [] }]);
    expect(queue.takeMailbox()).toEqual([{ id: 'mail_1', fromAgentId: 'agent_1', content: 'agent update' }]);
    expect(queue.hasPending()).toBe(false);
  });
});

function runtimeUserMessage(id: string, content: string): RuntimeMessage {
  return {
    id,
    turnId: 'turn_1',
    role: 'user',
    content,
    createdAt: '2026-07-07T00:00:00.000Z',
    status: 'complete',
  };
}
