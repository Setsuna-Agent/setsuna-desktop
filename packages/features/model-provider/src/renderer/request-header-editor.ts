import { normalizeProviderRequestHeaders, type ProviderRequestHeaders } from '@setsuna-desktop/contracts';

export function formatRequestHeaders(headers: Readonly<ProviderRequestHeaders>): string {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n');
}

export function parseRequestHeaders(text: string): ProviderRequestHeaders {
  const entries = text.split(/\r?\n/u).filter((line) => line.trim()).map((line): [string, string] => {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error('Each request header needs a name and a colon.');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  });
  if (new Set(entries.map(([name]) => name.toLowerCase())).size !== entries.length) {
    throw new Error('Duplicate HTTP header names are not allowed.');
  }
  return normalizeProviderRequestHeaders(Object.fromEntries(entries))!;
}
