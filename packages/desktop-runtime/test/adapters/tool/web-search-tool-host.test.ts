import {
  RUNTIME_WEB_SEARCH_QUERY_MAX_CHARS,
  WEB_SEARCH_PLUGIN_ID,
  WEB_SEARCH_TOOL_NAME,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { WebSearchToolHost } from '../../../src/adapters/tool/web-search-tool-host.js';
import type { WebSearchRequest } from '../../../src/ports/web-search.js';

describe('WebSearchToolHost', () => {
  it('advertises the tool only while the bundled plugin is installed', async () => {
    const host = toolHost(true);

    await expect(host.listTools({ threadId: 'thread_1' })).resolves.toEqual([
      expect.objectContaining({ name: WEB_SEARCH_TOOL_NAME }),
    ]);
    await expect(host.listTools({ threadId: 'thread_1', features: { plugins: false } })).resolves.toEqual([]);
    await expect(toolHost(false).listTools({ threadId: 'thread_1' })).resolves.toEqual([]);
    await expect(host.toolRuntimeProfile(WEB_SEARCH_TOOL_NAME)).resolves.toEqual({
      exposure: 'direct',
      supportsParallel: true,
      plugin: {
        id: WEB_SEARCH_PLUGIN_ID,
        name: '网络搜索',
        icon: 'web-search',
      },
    });
    await expect(host.systemPrompt({ threadId: 'thread_1' })).resolves.toContain('untrusted external content');
  });

  it('normalizes filters and returns source-bearing external context', async () => {
    let captured: WebSearchRequest | undefined;
    const controller = new AbortController();
    const host = toolHost(true, async (request) => {
      captured = request;
      return {
        provider: 'tavily-keyless',
        query: request.query,
        results: [{
          title: 'Official documentation',
          url: 'https://example.com/docs',
          snippet: 'Current documentation content.',
          score: 0.91,
          publishedDate: '2026-08-01',
        }],
      };
    });

    const result = await host.runTool(WEB_SEARCH_TOOL_NAME, {
      query: 'current API documentation',
      max_results: 3,
      topic: 'general',
      time_range: 'month',
      include_domains: ['Example.com', '*.example.com'],
      exclude_domains: ['spam.example'],
    }, { threadId: 'thread_1', signal: controller.signal });

    expect(captured).toEqual({
      query: 'current API documentation',
      maxResults: 3,
      topic: 'general',
      timeRange: 'month',
      includeDomains: ['example.com'],
      excludeDomains: ['spam.example'],
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      preview: '已找到 1 个网络来源',
      containsExternalContext: true,
      data: {
        pluginId: WEB_SEARCH_PLUGIN_ID,
        provider: 'tavily-keyless',
        query: 'current API documentation',
        resultCount: 1,
        sources: [{
          title: 'Official documentation',
          url: 'https://example.com/docs',
          score: 0.91,
          publishedDate: '2026-08-01',
        }],
      },
    });
    expect(result.content).toContain('Title: Official documentation');
    expect(result.content).toContain('URL: https://example.com/docs');
    expect(result.content).toContain('untrusted external content');
  });

  it('validates query and domain filters before sending a request', async () => {
    const host = toolHost(true);

    await expect(host.runTool(WEB_SEARCH_TOOL_NAME, {
      query: 'x'.repeat(RUNTIME_WEB_SEARCH_QUERY_MAX_CHARS + 1),
    }, { threadId: 'thread_1' })).rejects.toThrow('query must not exceed');
    await expect(host.runTool(WEB_SEARCH_TOOL_NAME, {
      query: 'test',
      include_domains: ['https://example.com/path'],
    }, { threadId: 'thread_1' })).rejects.toThrow('contains an invalid domain');
  });
});

function toolHost(
  installed: boolean,
  search: (request: WebSearchRequest) => Promise<{
    provider: 'tavily-keyless';
    query: string;
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      score?: number;
      publishedDate?: string;
    }>;
  }> = async (request) => ({ provider: 'tavily-keyless', query: request.query, results: [] }),
) {
  return new WebSearchToolHost({
    async listPlugins() {
      return {
        plugins: installed ? [{
          id: WEB_SEARCH_PLUGIN_ID,
          name: '网络搜索',
          icon: 'web-search',
          installedAt: '2026-08-09T00:00:00.000Z',
          tools: [{ name: WEB_SEARCH_TOOL_NAME }],
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }] : [],
      };
    },
  }, { search });
}
