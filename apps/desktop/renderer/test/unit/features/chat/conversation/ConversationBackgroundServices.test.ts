import type { RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationBackgroundServiceList,
} from '../../../../../src/features/chat/conversation/ConversationBackgroundServiceList.js';
import {
  ConversationBackgroundServices,
} from '../../../../../src/features/chat/conversation/ConversationBackgroundServices.js';

describe('ConversationBackgroundServiceList', () => {
  it('renders no panel chrome before a running service is available', () => {
    const html = renderToStaticMarkup(createElement(ConversationBackgroundServices, {
      client: {
        listBackgroundShellProcesses: async () => ({ processes: [] }),
        terminateBackgroundShellProcess: async () => ({ terminated: false }),
      },
      threadId: 'thread_1',
    }));

    expect(html).toBe('');
  });

  it('shows running service metadata and exposes an explicit terminate action', () => {
    const onTerminate = vi.fn();
    const html = renderToStaticMarkup(createElement(ConversationBackgroundServiceList, {
      error: null,
      processes: [process],
      terminatingIds: new Set<string>(),
      onTerminate,
    }));

    expect(html).toContain('后台服务');
    expect(html).not.toContain('个后台服务');
    expect(html).toContain('chat-conversation-background-service__icon');
    expect(html).toContain('pnpm dev --host 127.0.0.1');
    expect(html).not.toContain('已运行');
    expect(html).not.toContain('chat-conversation-background-service__status');
    expect(html).toContain('aria-label="终止后台服务：pnpm dev --host 127.0.0.1"');
    expect(html).toContain('title="终止服务"');

    const view = ConversationBackgroundServiceList({
      error: null,
      processes: [process],
      terminatingIds: new Set<string>(),
      onTerminate,
    });
    if (!view) throw new Error('Expected a populated background service list.');
    const service = view.props.children[1].props.children[0];
    service.props.children[2].props.onClick();
    expect(onTerminate).toHaveBeenCalledWith(process.id);
  });

  it('hides an empty list and disables duplicate termination actions', () => {
    const emptyHtml = renderToStaticMarkup(createElement(ConversationBackgroundServiceList, {
      error: null,
      processes: [],
      terminatingIds: new Set<string>(),
      onTerminate: () => undefined,
    }));
    const terminatingHtml = renderToStaticMarkup(createElement(ConversationBackgroundServiceList, {
      error: null,
      processes: [process],
      terminatingIds: new Set([process.id]),
      onTerminate: () => undefined,
    }));

    expect(emptyHtml).toBe('');
    expect(terminatingHtml).toContain('title="正在终止服务"');
    expect(terminatingHtml).toContain('disabled=""');
  });
});

const process: RuntimeBackgroundShellProcess = {
  id: 'shell_1',
  threadId: 'thread_1',
  turnId: 'turn_1',
  toolCallId: 'call_1',
  command: 'pnpm dev\n  --host 127.0.0.1',
  directory: 'apps/web',
  startedAt: '2026-07-20T02:00:00.000Z',
  expiresAt: '2026-07-20T08:00:00.000Z',
};
