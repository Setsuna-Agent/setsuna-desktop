export type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function requireFetch(fetchImpl: FetchImpl | undefined): FetchImpl {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Current Node runtime does not expose fetch.');
  }
  return fetchImpl;
}

export function withEndpoint(baseUrl: string, endpoint: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '');
  if (!trimmed) throw new Error('Provider base URL is required.');
  if (trimmed.endsWith(endpoint)) return trimmed;
  return `${trimmed}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export function bearerAuthHeader(apiKey: string): Record<string, string> {
  const token = apiKey.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function anthropicApiKeyHeader(apiKey: string): Record<string, string> {
  const token = apiKey.trim();
  return token ? { 'x-api-key': token } : {};
}

export async function assertOkResponse(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => '');
  throw new Error(`${label}: HTTP ${response.status}${text ? ` ${text.slice(0, 500)}` : ''}`);
}
