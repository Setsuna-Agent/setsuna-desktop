export const OPEN_BROWSER_TOOL_NAME = 'open_browser';

export type RuntimeBrowserOpenAction = {
  kind: 'browser.open';
  url: string;
};

/** 渲染进程执行浏览器导航前，校验界面操作数据。 */
export function parseRuntimeBrowserOpenAction(value: unknown): RuntimeBrowserOpenAction | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { kind?: unknown; url?: unknown };
  if (candidate.kind !== 'browser.open' || typeof candidate.url !== 'string') return null;
  try {
    const url = new URL(candidate.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { kind: 'browser.open', url: url.href };
  } catch {
    return null;
  }
}
