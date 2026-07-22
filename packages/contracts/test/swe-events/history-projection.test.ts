import { describe, expect, it } from 'vitest';
import {
  runtimeThreadToSweTurns
} from '../../src/swe-events.js';
import type { RuntimeThread } from '../../src/threads.js';

describe('runtime AppServer SWE persisted history projection', () => {
  it('projects stored runtime thread history into AppServer turn items', () => {
      const thread: RuntimeThread = {
        id: 'thread_1',
        title: 'Stored thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:04.000Z',
        archived: false,
        messageCount: 4,
        lastMessagePreview: 'Done',
        lastSeq: 4,
        messages: [
          {
            id: 'msg_user',
            turnId: 'turn_1',
            role: 'user',
            content: 'Run tests and edit a file.',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'complete',
          },
          {
            id: 'msg_assistant_tools',
            turnId: 'turn_1',
            role: 'assistant',
            content: '',
            createdAt: '2026-06-27T00:00:01.000Z',
            status: 'complete',
            toolRuns: [
              {
                id: 'call_shell',
                name: 'run_shell_command',
                status: 'success',
                argumentsPreview: '{"command":"pnpm test","directory":"."}',
                resultPreview: '$ pnpm test\nexit: 0',
                data: { process_id: 'shell_1', command: 'pnpm test', directory: '.', exit_code: 0 },
                durationMs: 42,
              },
              {
                id: 'call_file',
                name: 'write_file',
                status: 'success',
                resultPreview: JSON.stringify({
                  diff: {
                    path: 'src/generated.txt',
                    action: 'Created',
                    lines: [{ type: 'added', content: 'generated' }],
                  },
                }),
              },
            ],
          },
          {
            id: 'msg_tool',
            turnId: 'turn_1',
            role: 'tool',
            toolCallId: 'call_shell',
            toolName: 'run_shell_command',
            content: '$ pnpm test\nexit: 0',
            createdAt: '2026-06-27T00:00:02.000Z',
            status: 'complete',
          },
          {
            id: 'msg_injected',
            turnId: 'turn_1',
            role: 'user',
            content: 'Hidden model-only boundary.',
            createdAt: '2026-06-27T00:00:02.500Z',
            status: 'complete',
            visibility: 'model',
          },
          {
            id: 'msg_assistant_done',
            turnId: 'turn_1',
            role: 'assistant',
            content: 'Done.',
            createdAt: '2026-06-27T00:00:03.000Z',
            completedAt: '2026-06-27T00:00:04.000Z',
            status: 'complete',
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
        id: 'turn_1',
        status: 'completed',
        items: [
          { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'Run tests and edit a file.' }] },
          {
            type: 'commandExecution',
            id: 'call_shell',
            command: 'pnpm test',
            cwd: '.',
            processId: 'shell_1',
            exitCode: 0,
            durationMs: 42,
          },
          {
            type: 'fileChange',
            id: 'call_file',
            changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
            status: 'completed',
          },
          { type: 'agentMessage', id: 'msg_assistant_done', text: 'Done.' },
        ],
      }]);
    });
  
  it('projects persisted runtime turn stream items ahead of transcript fallbacks', () => {
      const thread: RuntimeThread = {
        id: 'thread_1',
        title: 'Stored item stream thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:05.000Z',
        archived: false,
        messageCount: 2,
        lastMessagePreview: 'Hello from item stream.',
        lastSeq: 8,
        turns: [
          {
            id: 'turn_1',
            input: 'stream using response items',
            startedAt: '2026-06-27T00:00:00.000Z',
            completedAt: '2026-06-27T00:00:05.000Z',
            status: 'completed',
            diff: 'diff --git a/a.txt b/a.txt',
            items: [
              { id: 'plan_item_1', kind: 'plan', status: 'completed', content: '1. Inspect state.' },
              { id: 'reasoning_item_1', kind: 'reasoning', status: 'completed', content: 'Need context.' },
              {
                id: 'agent_item_1',
                kind: 'agent_message',
                status: 'completed',
                content: 'Hello from item stream.',
                transcriptMessageId: 'msg_assistant',
              },
            ],
            modelVerifications: [{ model: 'current-model', provider: 'setsuna', warnings: ['fallback'] }],
            safetyBuffering: {
              model: 'current-model',
              fasterModel: 'fast-model',
              reasons: ['policy'],
              showBufferingUi: true,
              useCases: ['cyber'],
            },
            stepSnapshots: [{
              createdAt: '2026-06-27T00:00:00.500Z',
              snapshot: {
                threadId: 'thread_1',
                turnId: 'turn_1',
                threadLastSeq: 8,
                conversationMessageIds: ['msg_user'],
                messageIds: ['msg_user', 'msg_assistant'],
                toolNames: ['run_shell_command'],
                toolChoice: 'auto',
                toolEnvironment: { id: 'project_1', cwd: '/tmp/project' },
                selectedSkills: [],
                mcpServerKeys: [],
                mcpServerCount: 0,
                permissionProfile: 'workspace-write',
                featureKeys: [],
                worldState: {
                  threadMessageCount: 2,
                  threadUpdatedAt: '2026-06-27T00:00:05.000Z',
                },
              },
            }],
            tokenCounts: [{
              createdAt: '2026-06-27T00:00:04.000Z',
              usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
              modelContextWindow: 128000,
              tokensUntilCompaction: 64000,
            }],
          },
        ],
        messages: [
          {
            id: 'msg_user',
            turnId: 'turn_1',
            role: 'user',
            content: 'stream using response items',
            createdAt: '2026-06-27T00:00:01.000Z',
            status: 'complete',
          },
          {
            id: 'msg_assistant',
            turnId: 'turn_1',
            role: 'assistant',
            content: 'Hello from item stream.',
            createdAt: '2026-06-27T00:00:02.000Z',
            completedAt: '2026-06-27T00:00:05.000Z',
            status: 'complete',
            toolRuns: [{
              id: 'call_shell',
              name: 'run_shell_command',
              status: 'success',
              argumentsPreview: '{"command":"pnpm test"}',
              resultPreview: '$ pnpm test\nexit: 0',
              data: { process_id: 'shell_1', command: 'pnpm test', directory: '.', exit_code: 0 },
            }],
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
        id: 'turn_1',
        status: 'completed',
        startedAt: 1782518400,
        completedAt: 1782518405,
        diff: 'diff --git a/a.txt b/a.txt',
        modelVerifications: [{ model: 'current-model', provider: 'setsuna', warnings: ['fallback'] }],
        safetyBuffering: {
          model: 'current-model',
          fasterModel: 'fast-model',
          reasons: ['policy'],
          showBufferingUi: true,
          useCases: ['cyber'],
        },
        stepSnapshots: [{
          createdAtMs: 1782518400500,
          snapshot: {
            threadId: 'thread_1',
            turnId: 'turn_1',
            toolNames: ['run_shell_command'],
            toolEnvironment: { id: 'project_1', cwd: '/tmp/project' },
          },
        }],
        tokenCounts: [{
          createdAtMs: 1782518404000,
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          modelContextWindow: 128000,
          tokensUntilCompaction: 64000,
        }],
        items: [
          { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'stream using response items' }] },
          { type: 'plan', id: 'plan_item_1', text: '1. Inspect state.' },
          { type: 'reasoning', id: 'reasoning_item_1', summary: ['Need context.'] },
          { type: 'agentMessage', id: 'agent_item_1', text: 'Hello from item stream.' },
          { type: 'commandExecution', id: 'call_shell', command: 'pnpm test', processId: 'shell_1' },
        ],
      }]);
      const items = runtimeThreadToSweTurns(thread)[0]?.items ?? [];
      expect(items.filter((item) => item.id === 'msg_assistant')).toEqual([]);
    });
  
  it('merges tool result data into persisted stream tool call items', () => {
      const thread: RuntimeThread = {
        id: 'thread_1',
        title: 'Stored dynamic tool item thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:04.000Z',
        archived: false,
        messageCount: 2,
        lastMessagePreview: 'Done.',
        lastSeq: 6,
        turns: [{
          id: 'turn_1',
          startedAt: '2026-06-27T00:00:00.000Z',
          completedAt: '2026-06-27T00:00:04.000Z',
          status: 'completed',
          items: [{
            id: 'call_dynamic',
            kind: 'tool_call',
            status: 'completed',
            toolCall: { id: 'call_dynamic', name: 'tickets__lookup_ticket', arguments: '{"id":"ABC-123"}' },
          }],
        }],
        messages: [
          {
            id: 'msg_user',
            turnId: 'turn_1',
            role: 'user',
            content: 'Look up ticket ABC-123.',
            createdAt: '2026-06-27T00:00:01.000Z',
            status: 'complete',
          },
          {
            id: 'msg_assistant',
            turnId: 'turn_1',
            role: 'assistant',
            content: 'Done.',
            createdAt: '2026-06-27T00:00:02.000Z',
            completedAt: '2026-06-27T00:00:04.000Z',
            status: 'complete',
            toolRuns: [{
              id: 'call_dynamic',
              name: 'tickets__lookup_ticket',
              status: 'success',
              argumentsPreview: '{"id":"ABC-123"}',
              data: {
                contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
                success: true,
              },
              durationMs: 15,
            }],
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)[0]?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'dynamicToolCall',
          id: 'call_dynamic',
          tool: 'tickets__lookup_ticket',
          contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
          success: true,
          durationMs: 15,
        }),
      ]));
    });
  
  it('projects active runtime turns as in progress', () => {
      const thread: RuntimeThread = {
        id: 'thread_1',
        title: 'Active thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:01.000Z',
        archived: false,
        messageCount: 1,
        lastMessagePreview: '',
        lastSeq: 2,
        messages: [
          {
            id: 'msg_assistant',
            turnId: 'turn_1',
            role: 'assistant',
            content: '',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'streaming',
            toolRuns: [
              {
                id: 'call_shell',
                name: 'run_shell_command',
                status: 'running',
                argumentsPreview: '{"command":"pnpm test"}',
                resultPreview: 'stdout: running\n',
              },
            ],
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
        id: 'turn_1',
        status: 'inProgress',
        completedAt: null,
        durationMs: null,
        items: [
          {
            type: 'commandExecution',
            id: 'call_shell',
            command: 'pnpm test',
            status: 'inProgress',
            aggregatedOutput: 'stdout: running\n',
          },
        ],
      }]);
    });
  
  it('projects compacted context summaries into the source turn without reordering retained history', () => {
      const thread: RuntimeThread = {
        id: 'thread_1',
        title: 'Compacted thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:04.000Z',
        archived: false,
        messageCount: 3,
        lastMessagePreview: 'Continue.',
        lastSeq: 4,
        messages: [
          {
            id: 'msg_compaction',
            turnId: 'turn_2',
            role: 'user',
            content: '<context_compaction_summary>Earlier work.</context_compaction_summary>',
            createdAt: '2026-06-27T00:00:03.000Z',
            status: 'complete',
            contextCompaction: {
              compactedMessageCount: 10,
              compactedTokens: 100,
              keptRecentMessageCount: 2,
              maxContextTokensK: 256,
              originalMessageCount: 12,
              originalTokens: 300000,
              triggerScopes: ['total'],
            },
          },
          {
            id: 'msg_retained',
            turnId: 'turn_1',
            role: 'assistant',
            content: 'Recent retained answer.',
            createdAt: '2026-06-27T00:00:01.000Z',
            status: 'complete',
          },
          {
            id: 'msg_user',
            turnId: 'turn_2',
            role: 'user',
            content: 'Continue.',
            createdAt: '2026-06-27T00:00:02.000Z',
            status: 'complete',
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([
        {
          id: 'turn_1',
          items: [{ type: 'agentMessage', id: 'msg_retained', text: 'Recent retained answer.' }],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'Continue.' }] },
            { type: 'contextCompaction', id: 'turn_2:context_compaction' },
          ],
        },
      ]);
    });
  
  it('projects mailbox deliveries into AppServer collabToolCall history items', () => {
      const thread: RuntimeThread = {
        id: 'thread_parent',
        title: 'Mailbox thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:03.000Z',
        archived: false,
        messageCount: 2,
        lastMessagePreview: 'Handled.',
        lastSeq: 4,
        mailboxDeliveries: [
          {
            id: 'mail_1',
            turnId: 'turn_parent',
            createdAt: '2026-06-27T00:00:01.000Z',
            content: 'child found the regression',
            deliveryMode: 'queue_only',
            fromThreadId: 'thread_child',
            fromAgentId: 'agent_child',
          },
        ],
        messages: [
          {
            id: 'msg_user',
            turnId: 'turn_parent',
            role: 'user',
            content: 'Check auth.',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'complete',
          },
          {
            id: 'msg_assistant',
            turnId: 'turn_parent',
            role: 'assistant',
            content: 'Handled.',
            createdAt: '2026-06-27T00:00:02.000Z',
            completedAt: '2026-06-27T00:00:03.000Z',
            status: 'complete',
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([
        {
          id: 'turn_parent',
          items: [
            { type: 'userMessage', id: 'msg_user' },
            {
              type: 'collabToolCall',
              id: 'mailbox_mail_1',
              tool: 'send_input',
              status: 'completed',
              senderThreadId: 'thread_child',
              receiverThreadId: 'thread_parent',
              prompt: 'child found the regression',
            },
            { type: 'agentMessage', id: 'msg_assistant', text: 'Handled.' },
          ],
        },
      ]);
    });
  
  it('projects persisted Plan mode assistant messages as AppServer plan items', () => {
      const thread: RuntimeThread = {
        id: 'thread_plan',
        title: 'Plan thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:02.000Z',
        archived: false,
        messageCount: 2,
        lastMessagePreview: '1. Inspect first.',
        lastSeq: 2,
        messages: [
          {
            id: 'msg_user',
            turnId: 'turn_plan',
            role: 'user',
            content: 'Plan before editing.',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'complete',
          },
          {
            id: 'msg_plan',
            turnId: 'turn_plan',
            role: 'assistant',
            content: '1. Inspect first.\n2. Wait for confirmation.',
            createdAt: '2026-06-27T00:00:01.000Z',
            completedAt: '2026-06-27T00:00:02.000Z',
            status: 'complete',
            planMode: { mode: 'plan', status: 'awaiting_confirmation' },
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([
        {
          id: 'turn_plan',
          items: [
            { type: 'userMessage', id: 'msg_user' },
            {
              type: 'plan',
              id: 'msg_plan',
              text: '1. Inspect first.\n2. Wait for confirmation.',
              status: 'awaiting_confirmation',
            },
          ],
        },
      ]);
    });
  
  it('projects stored review mode markers into the source turn', () => {
      const thread: RuntimeThread = {
        id: 'thread_review',
        title: 'Review thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:03.000Z',
        archived: false,
        messageCount: 4,
        lastMessagePreview: 'No findings.',
        lastSeq: 4,
        messages: [
          {
            id: 'turn_review',
            turnId: 'turn_review',
            role: 'user',
            content: 'commit 1234567: Tidy UI colors',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'complete',
          },
          {
            id: 'msg_review_entered',
            turnId: 'turn_review',
            role: 'system',
            content: '',
            createdAt: '2026-06-27T00:00:01.000Z',
            status: 'complete',
            visibility: 'transcript',
            reviewMode: { kind: 'entered', review: 'commit 1234567: Tidy UI colors' },
          },
          {
            id: 'msg_assistant',
            turnId: 'turn_review',
            role: 'assistant',
            content: 'No findings.',
            createdAt: '2026-06-27T00:00:02.000Z',
            status: 'complete',
          },
          {
            id: 'msg_review_exited',
            turnId: 'turn_review',
            role: 'system',
            content: '',
            createdAt: '2026-06-27T00:00:03.000Z',
            status: 'complete',
            visibility: 'transcript',
            reviewMode: { kind: 'exited', review: 'No findings.' },
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
        id: 'turn_review',
        items: [
          { type: 'userMessage', id: 'turn_review', content: [{ type: 'text', text: 'commit 1234567: Tidy UI colors' }] },
          { type: 'enteredReviewMode', id: 'turn_review', review: 'commit 1234567: Tidy UI colors' },
          { type: 'agentMessage', id: 'msg_assistant', text: 'No findings.' },
          { type: 'exitedReviewMode', id: 'turn_review', review: 'No findings.' },
        ],
      }]);
    });
  
  it('keeps stored review mode markers when canonical stream items exist', () => {
      const thread: RuntimeThread = {
        id: 'thread_review',
        title: 'Review stream thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:04.000Z',
        archived: false,
        messageCount: 4,
        lastMessagePreview: 'Captured.',
        lastSeq: 4,
        turns: [{
          id: 'turn_review',
          startedAt: '2026-06-27T00:00:00.000Z',
          completedAt: '2026-06-27T00:00:04.000Z',
          status: 'completed',
          items: [{
            id: 'ai_sdk_agent_message_0',
            kind: 'agent_message',
            status: 'completed',
            content: 'Captured.',
          }],
        }],
        messages: [
          {
            id: 'turn_review',
            turnId: 'turn_review',
            role: 'user',
            content: 'commit 1234567: Tidy UI colors',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'complete',
          },
          {
            id: 'msg_review_entered',
            turnId: 'turn_review',
            role: 'system',
            content: '',
            createdAt: '2026-06-27T00:00:01.000Z',
            status: 'complete',
            visibility: 'transcript',
            reviewMode: { kind: 'entered', review: 'commit 1234567: Tidy UI colors' },
          },
          {
            id: 'msg_assistant',
            turnId: 'turn_review',
            role: 'assistant',
            content: 'Captured.',
            createdAt: '2026-06-27T00:00:02.000Z',
            status: 'complete',
          },
          {
            id: 'msg_review_exited',
            turnId: 'turn_review',
            role: 'system',
            content: '',
            createdAt: '2026-06-27T00:00:03.000Z',
            status: 'complete',
            visibility: 'transcript',
            reviewMode: { kind: 'exited', review: 'Captured.' },
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)[0]?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'userMessage', id: 'turn_review' }),
        expect.objectContaining({ type: 'enteredReviewMode', id: 'turn_review', review: 'commit 1234567: Tidy UI colors' }),
        expect.objectContaining({ type: 'agentMessage', text: 'Captured.' }),
        expect.objectContaining({ type: 'exitedReviewMode', id: 'turn_review', review: 'Captured.' }),
      ]));
    });
  
  it('projects stored assistant thinking as reasoning before visible agent text', () => {
      const thread: RuntimeThread = {
        id: 'thread_1',
        title: 'Reasoning thread',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:02.000Z',
        archived: false,
        messageCount: 2,
        lastMessagePreview: 'Done.',
        lastSeq: 2,
        messages: [
          {
            id: 'msg_user',
            turnId: 'turn_1',
            role: 'user',
            content: 'Explain.',
            createdAt: '2026-06-27T00:00:00.000Z',
            status: 'complete',
          },
          {
            id: 'msg_assistant',
            turnId: 'turn_1',
            role: 'assistant',
            content: '<think>plan</think>Done.',
            createdAt: '2026-06-27T00:00:01.000Z',
            completedAt: '2026-06-27T00:00:02.000Z',
            status: 'complete',
          },
        ],
      };
  
      expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
        id: 'turn_1',
        status: 'completed',
        items: [
          { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'Explain.' }] },
          { type: 'reasoning', id: 'msg_assistant:reasoning', summary: ['plan'], content: [] },
          { type: 'agentMessage', id: 'msg_assistant', text: 'Done.' },
        ],
      }]);
    });
});
