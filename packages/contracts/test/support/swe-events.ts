import type { RuntimeEvent } from '../../src/events.js';



export function fileCompletedEvent(seq: number, path: string, line: string): RuntimeEvent {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'tool.completed',
    createdAt: '2026-06-27T00:00:01.000Z',
    payload: {
      toolCallId: `call_${seq}`,
      toolName: 'write_file',
      status: 'success',
      content: JSON.stringify({
        diff: {
          path,
          action: 'Created',
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [{ type: 'added', content: line, newLine: 1 }],
        },
      }),
    },
  };
}

export function toolStartedFilePreview(seq: number, callId: string, path: string, line: string): RuntimeEvent {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'tool.started',
    createdAt: '2026-06-27T00:00:00.000Z',
    payload: {
      toolCallId: callId,
      toolName: 'write_file',
      argumentsPreview: '{"file_path":"src/generated.txt"}',
      resultPreview: JSON.stringify({
        diff: {
          path,
          action: 'Created',
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [{ type: 'added', content: line, newLine: 1 }],
        },
      }),
    },
  };
}

