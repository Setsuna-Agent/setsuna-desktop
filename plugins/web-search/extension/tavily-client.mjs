import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

const ENDPOINT = 'https://api.tavily.com/search';
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_SNIPPET_CHARS = 4_000;
const MAX_TITLE_CHARS = 500;
const MAX_URL_CHARS = 4_096;

export function createTavilySearchClient(sessionId = randomUUID()) {
  return async (request, network) => {
    const response = await network.request({
      url: ENDPOINT,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Client-Source': 'setsuna-desktop',
        'X-Session-Id': sessionId,
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
        ...(request.includeDomains.length ? { include_domains: request.includeDomains } : {}),
        ...(request.excludeDomains.length ? { exclude_domains: request.excludeDomains } : {}),
      }),
      timeoutMs: 30_000,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
    const payload = parsePayload(response);
    if (response.status < 200 || response.status >= 300) {
      throw tavilyResponseError(response.status, payload);
    }
    const envelopeError = tavilyEnvelopeError(payload);
    if (envelopeError) throw new Error(envelopeError);
    const record = objectRecord(payload);
    return {
      provider: 'tavily-keyless',
      query: boundedText(record.query, 2_000) || request.query,
      results: normalizeTavilyResults(record.results, request.maxResults),
    };
  };
}

export function normalizeTavilyResults(value, maxResults) {
  if (!Array.isArray(value)) return [];
  const results = [];
  const seenUrls = new Set();
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

function parsePayload(response) {
  if (!response.body.trim()) return null;
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`网络搜索服务返回了无效 JSON（HTTP ${response.status}）。`);
  }
}

function safePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function boundedText(value, maxChars) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function tavilyResponseError(status, payload) {
  const detail = tavilyEnvelopeError(payload)
    || boundedText(objectRecord(payload).detail, 1_000)
    || boundedText(objectRecord(payload).message, 1_000);
  return new Error(`网络搜索失败（HTTP ${status}）${detail ? `：${detail}` : '。'}`);
}

function tavilyEnvelopeError(payload) {
  const error = objectRecord(objectRecord(payload).error);
  const message = boundedText(error.message, 1_000);
  if (!message) return null;
  const retryAfter = finiteNumber(error.retry_after_seconds);
  return retryAfter !== undefined
    ? `${message} 请在 ${Math.max(1, Math.ceil(retryAfter))} 秒后重试。`
    : message;
}
