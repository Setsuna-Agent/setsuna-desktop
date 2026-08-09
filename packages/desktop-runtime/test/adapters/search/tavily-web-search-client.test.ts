import { describe, expect, it } from 'vitest';
import {
  normalizeTavilyResults,
  TavilyWebSearchClient,
} from '../../../src/adapters/search/tavily-web-search-client.js';

describe('TavilyWebSearchClient', () => {
  it('uses keyless access and returns bounded, safe, deduplicated sources', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const client = new TavilyWebSearchClient({
      endpoint: 'https://search.example.test/search',
      sessionId: 'session_test',
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({
          query: 'current MCP release',
          results: [
            {
              title: 'Official release',
              url: 'https://example.com/releases/latest',
              content: 'Current release notes.',
              score: 0.95,
              published_date: '2026-08-01',
            },
            {
              title: 'Duplicate',
              url: 'https://example.com/releases/latest',
              content: 'Duplicate result.',
            },
            { title: 'Unsafe', url: 'javascript:alert(1)', content: 'Ignore me.' },
          ],
        });
      },
    });

    const response = await client.search({
      query: 'current MCP release',
      maxResults: 5,
      topic: 'news',
      timeRange: 'week',
      includeDomains: ['example.com'],
      excludeDomains: ['spam.example'],
    });

    expect(requestUrl).toBe('https://search.example.test/search');
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('x-tavily-access-mode')).toBe('keyless');
    expect(headers.get('x-client-source')).toBe('setsuna-desktop');
    expect(headers.get('x-session-id')).toBe('session_test');
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      query: 'current MCP release',
      search_depth: 'basic',
      max_results: 5,
      topic: 'news',
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      include_favicon: false,
      time_range: 'week',
      include_domains: ['example.com'],
      exclude_domains: ['spam.example'],
    });
    expect(response).toEqual({
      provider: 'tavily-keyless',
      query: 'current MCP release',
      results: [{
        title: 'Official release',
        url: 'https://example.com/releases/latest',
        snippet: 'Current release notes.',
        score: 0.95,
        publishedDate: '2026-08-01',
      }],
    });
  });

  it('surfaces keyless rate limits with a retry delay', async () => {
    const client = new TavilyWebSearchClient({
      fetchImpl: async () => Response.json({
        error: {
          code: 'keyless_rate_limit',
          message: 'Anonymous search limit reached.',
          retry_after_seconds: 12.1,
        },
      }, { status: 429 }),
    });

    await expect(client.search({ query: 'test', maxResults: 1 }))
      .rejects.toThrow('Anonymous search limit reached. 请在 13 秒后重试。');
  });

  it('rejects oversized service responses before parsing them', async () => {
    const client = new TavilyWebSearchClient({
      fetchImpl: async () => new Response('{}', {
        headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
      }),
    });

    await expect(client.search({ query: 'test', maxResults: 1 }))
      .rejects.toThrow('响应超过 2 MB 限制');
  });

  it('bounds snippets and result count in the normalizer', () => {
    const results = normalizeTavilyResults([
      { title: 'A', url: 'https://a.example', content: 'x'.repeat(5_000) },
      { title: 'B', url: 'https://b.example', content: 'B' },
    ], 1);

    expect(results).toHaveLength(1);
    expect(results[0]?.snippet).toHaveLength(4_000);
    expect(results[0]?.snippet.endsWith('…')).toBe(true);
  });
});
