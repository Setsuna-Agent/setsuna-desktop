import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { browserOpenRequestFromEvent } from '../../../../../src/features/workspace/browser/runtimeBrowserActions.js';

describe('browserOpenRequestFromEvent', () => {
  it('accepts successful open_browser actions', () => {
    const event = toolCompletedEvent({ kind: 'browser.open', url: 'https://www.baidu.com' });
    expect(browserOpenRequestFromEvent(event)).toEqual({ id: 'event_1', url: 'https://www.baidu.com/' });
  });

  it('rejects failed tools and unsafe action URLs', () => {
    expect(browserOpenRequestFromEvent(toolCompletedEvent({ kind: 'browser.open', url: 'file:///tmp/a' }))).toBeNull();
    expect(browserOpenRequestFromEvent(toolCompletedEvent({ kind: 'browser.open', url: 'https://www.baidu.com' }, 'error'))).toBeNull();
  });
});

function toolCompletedEvent(data: unknown, status: 'success' | 'error' = 'success'): RuntimeEvent {
  return {
    id: 'event_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    seq: 1,
    type: 'tool.completed',
    createdAt: '2026-07-11T00:00:00.000Z',
    payload: {
      toolCallId: 'call_1',
      toolName: 'open_browser',
      status,
      content: 'done',
      data,
    },
  };
}
