import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../src/events.js';
import {
  runtimeEventToSweNotifications
} from '../../src/swe-events.js';

describe('runtime AppServer SWE shell and collaboration tools', () => {
  it('preserves shell command execution details from completed tool events', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'tool.completed',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          toolCallId: 'call_1',
          toolName: 'run_shell_command',
          status: 'success',
          content: '$ pnpm test\nexit: 0',
          argumentsPreview: '{"command":"pnpm test","directory":"."}',
          durationMs: 123,
          data: {
            process_id: 'shell_1',
            command: 'pnpm test',
            directory: '.',
            exit_code: 0,
          },
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
          item: {
            type: 'commandExecution',
            id: 'call_1',
            command: 'pnpm test',
            cwd: '.',
            processId: 'shell_1',
            source: 'agent',
            status: 'completed',
            commandActions: [{ type: 'unknown', command: 'pnpm test' }],
            aggregatedOutput: '$ pnpm test\nexit: 0',
            exitCode: 0,
            durationMs: 123,
          },
        },
      }]);
    });
  
  it('maps shell output deltas to AppServer commandExecution outputDelta notifications', () => {
      const event: RuntimeEvent = {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'tool.output_delta',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          toolCallId: 'call_1',
          toolName: 'run_shell_command',
          stream: 'stdout',
          processId: 'shell_1',
          delta: 'hello\n',
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([{
        method: 'item/commandExecution/outputDelta',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          delta: 'hello\n',
        },
      }]);
    });
  
  it('maps mailbox deliveries to AppServer collabToolCall lifecycle notifications', () => {
      const event: RuntimeEvent = {
        id: 'event_mailbox_1',
        seq: 1,
        threadId: 'thread_parent',
        turnId: 'turn_parent',
        type: 'mailbox.delivered',
        createdAt: '2026-06-27T00:00:01.000Z',
        payload: {
          id: 'mail_1',
          content: 'child agent found a regression',
          deliveryMode: 'queue_only',
          fromAgentId: 'agent_child',
          fromThreadId: 'thread_child',
          toAgentId: 'agent_parent',
        },
      };
  
      expect(runtimeEventToSweNotifications(event)).toEqual([
        {
          method: 'item/started',
          params: {
            threadId: 'thread_parent',
            turnId: 'turn_parent',
            item: {
              type: 'collabToolCall',
              id: 'mailbox_mail_1',
              tool: 'send_input',
              status: 'inProgress',
              senderThreadId: 'thread_child',
              receiverThreadId: 'thread_parent',
              prompt: 'child agent found a regression',
            },
            startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
          },
        },
        {
          method: 'item/completed',
          params: {
            threadId: 'thread_parent',
            turnId: 'turn_parent',
            item: {
              type: 'collabToolCall',
              id: 'mailbox_mail_1',
              tool: 'send_input',
              status: 'completed',
              senderThreadId: 'thread_child',
              receiverThreadId: 'thread_parent',
              prompt: 'child agent found a regression',
            },
            completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
          },
        },
      ]);
    });
});
