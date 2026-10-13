import { parseRuntimeApiRequest, runtimeText, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { RuntimeApi } from '../../ports/runtime-api.js';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { ToolExecutionContext, ToolHost } from '../../ports/tool-host.js';
import { appBuilderToolOwner, requireAppBuilderTool } from './app-builder-tool-owner.js';

const TOOL_NAME = 'read_runtime_api';

/** Exposes runtime records to the agent without granting the desktop's file access. */
export class RuntimeApiToolHost implements ToolHost {
  constructor(private readonly api: RuntimeApi, private readonly plugins: Pick<PluginBundleStore, 'listPlugins'>) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    if (!await appBuilderToolOwner(this.plugins, TOOL_NAME, context)) return [];
    const text = runtimeText(context.interfaceLanguage);
    return [{
      name: TOOL_NAME,
      description: text(
        'Inspect live Setsuna backend APIs and data when building apps or integrations. Start with /v1/runtime-api for available routes. Use read_thread for conversation history. No active project is required. Workspace file and attachment endpoints are excluded; use file tools with the current read permissions.',
        '构建应用或集成时查看 Setsuna 后端的真实 API 和数据。先读 /v1/runtime-api 查看接口。会话历史使用 read_thread 读取。无需绑定当前项目。工作区文件和附件接口不开放给此工具；读取文件请使用遵守当前读取权限的文件工具。',
      ),
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string', description: '/v1/ path including optional query parameters; e.g. /v1/projects or /v1/threads?scope=all' } },
        required: ['path'],
      },
    }];
  }

  systemPrompt(): string {
    return 'Use read_runtime_api to inspect Setsuna backend APIs and data when building apps or integrations. Read conversation history with the built-in read_thread tool. Workspace file and attachment endpoints are not available through this agent tool; use file tools with the current readable roots and deny rules. Never guess environment variables or read private runtime files to find this data. Trusted sidebar apps can call window.setsunaUI.runtime.request({path, method, body}); extension handlers can call context.runtime.request with the same input. Both return {ok, status, data}, support all backend HTTP methods and do not need a selected project.';
  }

  async toolRuntimeProfile(name: string, context: ToolExecutionContext) {
    if (name !== TOOL_NAME) return null;
    const plugin = await appBuilderToolOwner(this.plugins, name, context);
    return plugin ? { plugin, supportsParallel: true } : null;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    if (name !== TOOL_NAME) throw new Error(`Unknown tool: ${name}`);
    await requireAppBuilderTool(this.plugins, name, context);
    const request = parseRuntimeApiRequest(input);
    if (request.method !== 'GET') throw new Error('read_runtime_api only accepts GET requests.');
    assertAgentRuntimeReadPath(request.path);
    const result = await this.api.request(request, context.signal);
    // Runtime records can embed MCP/web/tool output without retaining its provenance.
    return { content: JSON.stringify(result), data: result, preview: `GET ${request.path}`, containsExternalContext: true };
  }
}

function assertAgentRuntimeReadPath(path: string): void {
  const pathname = new URL(path, 'http://runtime.local').pathname;
  // These desktop routes read/search files as the host user, without ToolExecutionContext.
  // Keep the whole file route families out of the agent bridge, including image previews.
  if (/^\/v1\/(?:projects\/|workspace(?:\/|$)|attachments(?:\/|$))/u.test(pathname)
    || /^\/v1\/threads\/[^/]+\/attachments(?:\/|$)/u.test(pathname)) {
    throw new Error('read_runtime_api cannot access workspace files or attachments. Use file tools with the current read permissions.');
  }
}
