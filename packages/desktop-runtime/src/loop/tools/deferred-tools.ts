import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';

export const SEARCH_TOOLS_TOOL_NAME = 'search_tools';

/** Search only the already permission-filtered catalog. Loading a schema never grants execution rights. */
export class DeferredTools {
  private readonly deferred: RuntimeToolDefinition[];

  constructor(catalog: RuntimeToolDefinition[], private readonly loaded: Set<string>) {
    this.deferred = catalog.filter((tool) => tool.name.startsWith('mcp__'));
  }

  isVisible(tool: RuntimeToolDefinition): boolean {
    return !tool.name.startsWith('mcp__') || this.loaded.has(tool.name);
  }

  definition(): RuntimeToolDefinition[] {
    if (!this.deferred.length) return [];
    const integrations = [...new Set(this.deferred.map((tool) => tool.name.split('__')[1]).filter(Boolean))];
    return [{
      name: SEARCH_TOOLS_TOOL_NAME,
      description: `Find available integration tools by capability or name before using them. Matching tools become callable on the next model request. Use short keywords (e.g. integration name and action). Available integrations: ${integrations.join(', ')}.`,
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['query'],
        properties: {
          query: { type: 'string', description: 'Keywords describing the required capability, or an exact tool name.' },
          limit: { type: 'integer', minimum: 1, maximum: 5, description: 'Maximum tools to load; defaults to 3.' },
        },
      },
    }];
  }

  search(input: unknown): string {
    const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!terms.length) throw new Error('search_tools requires non-empty query keywords.');
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 5)) {
      throw new Error('search_tools limit must be an integer between 1 and 5.');
    }
    const matches = this.deferred.map((tool) => {
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      const score = name === query ? Infinity : terms.reduce((sum, term) => sum + (name.includes(term) ? 3 : description.includes(term) ? 1 : 0), 0);
      return { tool, score };
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
      .slice(0, Number(args.limit ?? 3));
    for (const { tool } of matches) this.loaded.add(tool.name);
    return JSON.stringify({
      tools: matches.map(({ tool }) => ({ name: tool.name, description: tool.description.slice(0, 300) })),
      message: matches.length ? 'These tool definitions are now loaded. Call them directly to perform the requested work.' : 'No matching tools. Try the integration name or different capability keywords.',
    });
  }
}
