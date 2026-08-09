import { randomUUID } from 'node:crypto';
import type {
  WebSearchClient,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from '../../ports/web-search.js';
import { requireFetch, type FetchImpl } from '../model/provider-http.js';

const DEFAULT_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SNIPPET_CHARS = 4_000;
const MAX_TITLE_CHARS = 500;
const MAX_URL_CHARS = 4_096;

export type TavilyWebSearchClientOptions = {
  endpoint?: string;
  fetchImpl?: FetchImpl;
  sessionId?: string;
  timeoutMs?: number;
};

/**
 * Uses Tavily's official keyless access mode. The runtime sends no user identity
 * or model credentials; the random session id only groups requests in this process.
 */
export class TavilyWebSearchClient implements WebSearchClient {
  private readonly endpoint: string;
  private readonly fetchImpl: FetchImpl;
  private readonly sessionId: string;
  private readonly timeoutMs: number;

  constructor(options: TavilyWebSearchClientOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = requireFetch(options.fetchImpl ?? globalThis.fetch);
    this.sessionId = options.sessionId ?? randomUUID();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const signal = withTimeout(request.signal, this.timeoutMs);
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Client-Source': 'setsuna-desktop',
        'X-Session-Id': this.sessionId,
        'X-Tavily-Access-Mode': 'keyless',
      },
      body: JSON.stringify({
        query: request.query,
        search_depth: 'basic',
        max_results: request.maxResults,
        topic: request.topic ?? 'general',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        include_favicon: false,
        ...(request.timeRange ? { time_range: request.timeRange } : {}),
        ...(request.includeDomains?.length ? { include_domains: request.includeDomains } : {}),
        ...(request.excludeDomains?.length ? { exclude_domains: request.excludeDomains } : {}),
      }),
      signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw tavilyResponseError(response.status, payload);
    const envelopeError = tavilyEnvelopeError(payload);
    if (envelopeError) throw new Error(envelopeError);

    const record = objectRecord(payload);
    const results = normalizeTavilyResults(record.results, request.maxResults);
    return {
      provider: 'tavily-keyless',
      query: boundedText(record.query, 2_000) || request.query,
      results,
    };
  }
}

export function normalizeTavilyResults(value: unknown, maxResults: number): WebSearchResult[] {
  if (!Array.isArray(value)) return [];
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const item of value) {
    const record = objectRecord(item);
    const url = safePublicUrl(record.url);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const title = boundedText(record.title, MAX_TITLE_CHARS) || url;
    const snippet = boundedText(record.content, MAX_SNIPPET_CHARS);
    const score = finiteNumber(record.score);
    const publishedDate = boundedText(record.published_date, 100);
    results.push({
      title,
      url,
      snippet,
      ...(score !== undefined ? { score } : {}),
      ...(publishedDate ? { publishedDate } : {}),
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

function safePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function boundedText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const announcedSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_RESPONSE_BYTES) {
    throw new Error('网络搜索服务响应超过 2 MB 限制。');
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('网络搜索服务响应超过 2 MB 限制。');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`网络搜索服务返回了无效 JSON（HTTP ${response.status}）。`);
  }
}

function tavilyResponseError(status: number, payload: unknown): Error {
  const detail = tavilyEnvelopeError(payload)
    || boundedText(objectRecord(payload).detail, 1_000)
    || boundedText(objectRecord(payload).message, 1_000);
  return new Error(`网络搜索失败（HTTP ${status}）${detail ? `：${detail}` : '。'}`);
}

function tavilyEnvelopeError(payload: unknown): string | null {
  const error = objectRecord(objectRecord(payload).error);
  const message = boundedText(error.message, 1_000);
  if (!message) return null;
  const retryAfter = finiteNumber(error.retry_after_seconds);
  return retryAfter !== undefined
    ? `${message} 请在 ${Math.max(1, Math.ceil(retryAfter))} 秒后重试。`
    : message;
}

function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
