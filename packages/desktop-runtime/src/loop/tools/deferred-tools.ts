import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';

export const SEARCH_TOOLS_TOOL_NAME = 'search_tools';

// 日常读写、执行工具常驻；安装和配置能力在实际需要时才发送完整 schema。
const MANAGEMENT_TOOLS = new Set([
  'configure_mcp_server',
  'list_plugin_resources', 'read_plugin_resource', 'configure_plugin',
  'install_plugin_bundle', 'remove_plugin_bundle', 'verify_plugin',
  'configure_skill', 'install_skill_mcp_dependencies', 'authenticate_skill_mcp_dependency',
]);

function isDeferred(tool: RuntimeToolDefinition): boolean {
  return tool.name.startsWith('mcp__') || tool.name.startsWith('extension__') || MANAGEMENT_TOOLS.has(tool.name);
}

/** Search only the already permission-filtered catalog. Loading a schema never grants execution rights. */
export class DeferredTools {
  private readonly deferred: RuntimeToolDefinition[];

  constructor(catalog: RuntimeToolDefinition[], private readonly loaded: Set<string>) {
    this.deferred = catalog.filter(isDeferred);
  }

  isVisible(tool: RuntimeToolDefinition): boolean {
    return !isDeferred(tool) || this.loaded.has(tool.name);
  }

  definition(): RuntimeToolDefinition[] {
    if (!this.deferred.length) return [];
    const capabilities = [...new Set(this.deferred.map((tool) => (
      tool.name.includes('__') ? tool.name.split('__')[1] : tool.name
    )).filter(Boolean))];
    return [{
      name: SEARCH_TOOLS_TOOL_NAME,
      description: `Find integration, extension, plugin and skill management tools by capability or name before using them. Matching tools become callable on the next model request. Use short keywords or an exact tool name. Available capabilities: ${capabilities.join(', ')}.`,
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
