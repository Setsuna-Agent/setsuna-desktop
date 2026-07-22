import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { isActivityEvent } from '../../../../src/services/runtime-client/runtimeEvents.js';

describe('runtime event activity filtering', () => {
  it('keeps streaming tool output out of the high-level activity list', () => {
    const preview = toolEvent('tool.preview', {
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      argumentsPreview: '{"command":"pnpm',
      argumentsLength: 16,
    });
    const started = toolEvent('tool.started', {
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      argumentsPreview: '{"command":"pnpm test"}',
    });
    const outputDelta = toolEvent('tool.output_delta', {
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      delta: 'stdout: hello\n',
      stream: 'stdout',
    });
    const completed = toolEvent('tool.completed', {
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      status: 'success',
      content: '$ pnpm test\nexit: 0',
    });

    expect(isActivityEvent(preview)).toBe(false);
    expect(isActivityEvent(started)).toBe(true);
    expect(isActivityEvent(outputDelta)).toBe(false);
    expect(isActivityEvent(completed)).toBe(true);
  });
});

function toolEvent<TType extends RuntimeEvent['type']>(
  type: TType,
  payload: Extract<RuntimeEvent, { type: TType }>['payload'],
): Extract<RuntimeEvent, { type: TType }> {
  return {
    id: `event_${type}`,
    seq: 1,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type,
    createdAt: '2026-06-26T00:00:00.000Z',
    payload,
  } as Extract<RuntimeEvent, { type: TType }>;
}
