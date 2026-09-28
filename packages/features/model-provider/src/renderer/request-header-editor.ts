import { normalizeProviderRequestHeaders, type ProviderRequestHeaders } from '@setsuna-desktop/contracts';

export type RequestHeaderRow = Readonly<{ id: string; name: string; value: string }>;

export function createRequestHeaderRow(name = '', value = ''): RequestHeaderRow {
  return { id: crypto.randomUUID(), name, value };
}

export function requestHeaderRows(headers: Readonly<ProviderRequestHeaders>): RequestHeaderRow[] {
  const rows = Object.entries(headers).map(([name, value]) => createRequestHeaderRow(name, value));
  return rows.length ? rows : [createRequestHeaderRow()];
}

export function parseRequestHeaderRows(rows: readonly RequestHeaderRow[]): ProviderRequestHeaders {
  // Ignore untouched rows, but validate raw values before normalization can hide control characters.
  const entries = rows.filter(({ name, value }) => name !== '' || value !== '')
    .map(({ name, value }): [string, string] => [name.trim(), value]);
  if (new Set(entries.map(([name]) => name.toLowerCase())).size !== entries.length) {
    throw new Error('Duplicate HTTP header names are not allowed.');
  }
  return normalizeProviderRequestHeaders(Object.fromEntries(entries))!;
}
