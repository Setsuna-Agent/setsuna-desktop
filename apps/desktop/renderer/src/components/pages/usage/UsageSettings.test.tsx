import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UsageSettings } from './UsageSettings.js';

describe('UsageSettings', () => {
  it('renders the overview, calendar, rankings, and recent calls', () => {
    const html = renderToStaticMarkup(createElement(UsageSettings, {
      providers: [{
        id: 'minimax',
        name: 'MiniMax',
        provider: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [{
          id: 'minimax-m27',
          name: 'MiniMax M2.7',
          code: 'MiniMax-M2.7-highspeed',
          enabled: true,
          maxOutputTokens: 8192,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
      }],
      usage: {
        records: [{
          id: 'usage_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          createdAt: '2026-07-20T08:00:00.000Z',
          inputTokens: 800,
          cachedInputTokens: 600,
          outputTokens: 200,
          totalTokens: 1000,
          provider: 'MiniMax',
          model: 'MiniMax-M2.7-highspeed',
        }],
        summary: {
          inputTokens: 800,
          cachedInputTokens: 600,
          outputTokens: 200,
          totalTokens: 1000,
          recordCount: 1,
          byDay: [{ key: '2026-07-20', inputTokens: 800, cachedInputTokens: 600, outputTokens: 200, totalTokens: 1000, recordCount: 1 }],
          byProvider: [{ key: 'MiniMax', inputTokens: 800, cachedInputTokens: 600, outputTokens: 200, totalTokens: 1000, recordCount: 1 }],
          byModel: [{ key: 'MiniMax-M2.7-highspeed', inputTokens: 800, cachedInputTokens: 600, outputTokens: 200, totalTokens: 1000, recordCount: 1 }],
        },
      },
    }));

    expect(html).toContain('Token 活动');
    expect(html).toContain('厂商分布');
    expect(html).toContain('模型排行');
    expect(html).toContain('缓存命中');
    expect(html).toContain('brand-icon-mark');
    expect(html).toContain('MiniMax-M2.7-highspeed');
    expect(html).toContain('累计 1 次');
  });
});
