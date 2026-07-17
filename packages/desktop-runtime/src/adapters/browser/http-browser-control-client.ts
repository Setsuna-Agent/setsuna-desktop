import type { DesktopBrowserControlCommand, DesktopBrowserControlResult } from '@setsuna-desktop/contracts';
import type { BrowserControlPort } from '../../ports/browser-control.js';

export const browserControlUrlEnvironmentKey = 'SETSUNA_DESKTOP_BROWSER_CONTROL_URL';
export const browserControlTokenEnvironmentKey = 'SETSUNA_DESKTOP_BROWSER_CONTROL_TOKEN';

type Fetch = typeof fetch;

/** Electron 主进程所管理、已认证浏览器控制器的 runtime 侧适配器。 */
export class HttpBrowserControlClient implements BrowserControlPort {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      throw new Error('Browser control endpoint must use loopback HTTP.');
    }
    if (!token) throw new Error('Browser control token is required.');
    this.baseUrl = url.href.replace(/\/$/, '');
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): HttpBrowserControlClient | null {
    const url = environment[browserControlUrlEnvironmentKey]?.trim();
    const token = environment[browserControlTokenEnvironmentKey]?.trim();
    if (!url || !token) return null;
    return new HttpBrowserControlClient(url, token);
  }

  async execute(command: DesktopBrowserControlCommand, signal?: AbortSignal): Promise<DesktopBrowserControlResult> {
    const timeout = AbortSignal.timeout(30_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetchImpl(`${this.baseUrl}/v1/browser/command`, {
      body: JSON.stringify(command),
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: requestSignal,
    });
    const text = await response.text();
    const body = parseResponseBody(text);
    if (!response.ok) throw new Error(body.error ?? `Browser control request failed: ${response.status}`);
    if (!body.result || !isBrowserControlResult(body.result)) throw new Error('Browser control response is missing a valid result.');
    return body.result;
  }
}

function parseResponseBody(value: string): { error?: string; result?: unknown } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const body = parsed as { error?: unknown; result?: unknown };
    return { error: typeof body.error === 'string' ? body.error : undefined, result: body.result };
  } catch {
    return {};
  }
}

function isBrowserControlResult(value: unknown): value is DesktopBrowserControlResult {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'tabs' || kind === 'snapshot' || kind === 'screenshot' || kind === 'action' || kind === 'wait';
}
