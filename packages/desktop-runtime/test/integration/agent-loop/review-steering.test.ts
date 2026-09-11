import { createReviewTurnRequest } from '@setsuna-desktop/feature-review/runtime';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID } from '../../../src/loop/context/runtime-response-language.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { BlockingToolHost } from '../../support/agent-loop/steering-mailbox.js';
import {
  mkDataDir,
  ToolCallingModelClient,
  waitForTurnCompleted,
  WORKSPACE_READ_FILE_TOOL,
} from '../../support/agent-loop/shared.js';

describe('review steering', () => {
  it.each(['send-now', 'steer'] as const)('applies %s guidance in the same review after a tool, preserving read-only access', async (route) => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Review steering' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new BlockingToolHost();
    const listTools = vi.spyOn(toolHost, 'listTools').mockResolvedValue([
      WORKSPACE_READ_FILE_TOOL,
      { name: 'write_file', description: 'Write a file', inputSchema: {} },
    ]);
    const loop = new AgentLoop({
      threadStore, modelClient, toolHost, ids, clock: systemClock,
      eventBus: new InMemoryEventBus(),
    });
    const started = await loop.startReviewTurn(thread.id, createReviewTurnRequest(
      { type: 'uncommittedChanges' },
      'en-US',
    ));
    await toolHost.started;
    const input = { input: '讲中文啊，重点检查取消流程', clientId: 'review-guidance' };
    try {
      expect(modelClient.requests[0].messages.find((message) => (
        message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID
      ))?.content).toContain('The target response language for this turn is English');
      if (route === 'send-now') {
        const queued = await loop.queueTurnInput(thread.id, input);
        expect(queued.disposition).toBe('queued');
        await expect(loop.sendQueuedTurnInputNow(thread.id, queued.queuedInputId)).resolves.toMatchObject({
          disposition: 'steered',
          queuedInputId: queued.queuedInputId,
          turnId: started.turnId,
        });
      } else {
        await expect(loop.steerTurn(thread.id, {
          ...input, expectedTurnId: started.turnId,
        })).resolves.toEqual({ accepted: true, turnId: started.turnId });
      }
    } finally {
      toolHost.release();
    }
    await waitForTurnCompleted(threadStore, thread.id, started.turnId);

    expect(modelClient.requests).toHaveLength(2);
    const followUp = modelClient.requests[1];
    expect(followUp.messages).toContainEqual(expect.objectContaining({
      role: 'tool', content: 'file contents from blocked tool',
    }));
    expect(followUp.messages.filter((message) => message.clientId === input.clientId)).toEqual([
      expect.objectContaining({ content: input.input, role: 'user', turnId: started.turnId }),
    ]);
    expect(followUp.messages.filter((message) => (
      message.role === 'system' || message.role === 'developer'
    )).at(-1)).toMatchObject({
      id: RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID,
      content: expect.stringContaining('本轮回答的目标语言是简体中文'),
    });
    for (const request of modelClient.requests) {
      expect(request.tools?.map((tool) => tool.name)).toContain('workspace_read_file');
      expect(request.tools?.map((tool) => tool.name)).not.toContain('write_file');
      expect(request.messages.find((message) => message.id === 'desktop_review_policy')?.content)
        .toContain('do not modify files');
    }
    expect(listTools.mock.calls.every(([context]) => (
      context.readOnly === true && context.permissionProfile === 'read-only'
    ))).toBe(true);
    const saved = await threadStore.getThread(thread.id);
    expect(saved?.queuedTurnInputs ?? []).toEqual([]);
    expect(saved?.messages.filter((message) => message.clientId === input.clientId)).toHaveLength(1);
    const events = await threadStore.listEvents(thread.id);
    expect(events.filter((event) => event.type === 'turn.started')).toEqual([
      expect.objectContaining({ turnId: started.turnId, payload: expect.objectContaining({ taskKind: 'review' }) }),
    ]);
  });
});
