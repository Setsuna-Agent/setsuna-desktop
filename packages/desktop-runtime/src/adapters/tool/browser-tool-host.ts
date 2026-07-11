import {
  OPEN_BROWSER_TOOL_NAME,
  type RuntimeBrowserOpenAction,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type {
  ToolExecutionContext,
  ToolExecutionPreview,
  ToolExecutionResult,
  ToolHost,
} from '../../ports/tool-host.js';

const OPEN_BROWSER_TOOL: RuntimeToolDefinition = {
  name: OPEN_BROWSER_TOOL_NAME,
  description: 'Open a website in the application side browser. Use this whenever the user asks to open, visit, or show a website. Resolve well-known site names to their canonical URL, for example 百度 to https://www.baidu.com/.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      url: {
        type: 'string',
        description: 'The http or https URL to open. A hostname without a scheme is also accepted.',
      },
    },
    required: ['url'],
  },
};

export class BrowserToolHost implements ToolHost {
  async listTools(): Promise<RuntimeToolDefinition[]> {
    return [OPEN_BROWSER_TOOL];
  }

  systemPrompt(): string {
    return 'When the user asks to open or visit a website in the app, call open_browser with the site URL instead of merely describing or linking to it.';
  }

  async approvalForTool(): Promise<null> {
    return null;
  }

  async previewToolCall(name: string, input: unknown): Promise<ToolExecutionPreview | null> {
    if (name !== OPEN_BROWSER_TOOL_NAME) return null;
    const url = normalizeBrowserToolUrl(input);
    return {
      argumentsPreview: JSON.stringify({ url }),
      resultPreview: `在侧边浏览器打开 ${url}`,
    };
  }

  async runTool(name: string, input: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== OPEN_BROWSER_TOOL_NAME) throw new Error(`Unknown tool: ${name}`);
    const url = normalizeBrowserToolUrl(input);
    const data: RuntimeBrowserOpenAction = { kind: 'browser.open', url };
    return {
      content: `Opened ${url} in the side browser.`,
      preview: `在侧边浏览器打开 ${url}`,
      data,
    };
  }
}

export function normalizeBrowserToolUrl(input: unknown): string {
  if (!input || typeof input !== 'object') throw new Error('open_browser requires a URL.');
  const rawUrl = (input as { url?: unknown }).url;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('open_browser requires a non-empty URL.');
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid browser URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported browser URL protocol: ${url.protocol}`);
  }
  return url.href;
}
