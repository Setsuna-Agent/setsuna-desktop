import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeTurnInputQueue } from '../../../src/loop/lifecycle/turn-input-queue.js';

describe('runtime turn input queue', () => {
  it('wakes for preexisting and newly queued inputs and cleans up cancelled waits', async () => {
    const queue = new RuntimeTurnInputQueue();
    queue.enqueueMailbox({ id: 'first', content: 'already queued' });
    await queue.waitForInput(new AbortController().signal);
    queue.takeMailbox();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const waiting = queue.waitForInput(controller.signal);
    queue.enqueueSteer({ message: runtimeUserMessage('steer', 'changed direction'), skillIds: [] });
    await waiting;
    expect(remove).toHaveBeenCalled();
    queue.takeSteers();
    const cancelled = queue.waitForInput(controller.signal);
    const rejected = expect(cancelled).rejects.toThrow('cancel');
    controller.abort(new Error('cancel'));
    await rejected;
    queue.enqueueMailbox({ id: 'later', content: 'retained for the next wait' });
    await queue.waitForInput(new AbortController().signal);
    expect(queue.takeMailbox()).toHaveLength(1);
  });

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
