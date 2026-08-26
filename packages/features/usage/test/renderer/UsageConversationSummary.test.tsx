import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { UsageRendererStateService } from '../../src/contracts/index.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UsageRendererProvider } from '../../src/renderer/context.js';
import { UsageConversationSummary } from '../../src/renderer/UsageConversationSummary.js';
import { usageTestTranslate } from './support.js';

describe('UsageConversationSummary', () => {
  it('renders the Feature-owned durable usage projection', () => {
    const snapshot = {
      usage: {
        records: [],
        summary: {
          inputTokens: 800_000,
          cachedInputTokens: 756_000,
          outputTokens: 50_000,
          totalTokens: 850_000,
          recordCount: 1,
          byDay: [],
          byProvider: [],
          byModel: [],
        },
      },
      loading: false,
      error: null,
    } as const;
    const service: UsageRendererStateService = {
      available: true,
      controller: () => ({
        dispose: () => undefined,
        start: () => undefined,
        refresh: () => undefined,
        snapshot: () => snapshot,
        subscribe: () => () => undefined,
      }),
      invalidate: () => undefined,
      query: async () => ({ providers: [], usage: snapshot.usage }),
      subscribeInvalidation: () => () => undefined,
    };
    const html = renderToStaticMarkup(
      <UsageRendererProvider
        host={{ BrandIcon: () => null, Tooltip: ({ children, title }) => <span>{children}{title}</span> }}
        service={service}
        translate={usageTestTranslate}
      >
        <UsageConversationSummary thread={thread} />
      </UsageRendererProvider>,
    );

    expect(html).toContain('850.0K · 95% · 1 次');
    expect(html).toContain('总 Token');
    expect(html).toContain('缓存命中率');
    expect(html).toContain('调用次数');
  });
});

const thread: RuntimeThread = {
  id: 'thread_1',
  title: 'Usage fixture',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  archived: false,
  messageCount: 0,
  lastMessagePreview: '',
  messages: [],
  lastSeq: 0,
  turns: [],
};
