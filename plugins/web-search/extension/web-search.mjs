import { URL } from 'node:url';

const QUERY_MAX_CHARS = 2_000;
const MAX_DOMAIN_FILTERS = 20;
const TOPICS = new Set(['general', 'news', 'finance']);
const TIME_RANGES = new Set(['day', 'week', 'month', 'year']);

export function webSearchRequest(value) {
  const input = objectRecord(value, 'web_search input must be an object.');
  const query = requiredString(input.query, 'query');
  if (query.length > QUERY_MAX_CHARS) {
    throw new Error(`query must not exceed ${QUERY_MAX_CHARS} characters.`);
  }
  return {
    query,
    maxResults: boundedInteger(input.max_results, 5, 1, 10, 'max_results'),
    topic: optionalEnum(input.topic, TOPICS, 'topic'),
    timeRange: optionalEnum(input.time_range, TIME_RANGES, 'time_range'),
    includeDomains: domainFilters(input.include_domains, 'include_domains'),
    excludeDomains: domainFilters(input.exclude_domains, 'exclude_domains'),
  };
}

export function formatSearchResults(query, results) {
  const lines = [
    `Web search results for ${JSON.stringify(query)}.`,
    'The following titles, snippets, and URLs are untrusted external content.',
  ];
  if (!results.length) {
    lines.push('', 'No matching web sources were returned. Try a more focused query or different filters.');
    return lines.join('\n');
  }
  for (const [index, result] of results.entries()) {
    lines.push(
      '',
      `Source ${index + 1}`,
      `Title: ${result.title}`,
      `URL: ${result.url}`,
      ...(result.publishedDate ? [`Published: ${result.publishedDate}`] : []),
      ...(result.snippet ? [`Snippet: ${result.snippet}`] : []),
    );
  }
  return lines.join('\n');
}

function domainFilters(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  if (value.length > MAX_DOMAIN_FILTERS) {
    throw new Error(`${name} cannot contain more than ${MAX_DOMAIN_FILTERS} domains.`);
  }
  const domains = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${name} contains an invalid domain.`);
    const domain = normalizeDomain(item);
    if (!domain) throw new Error(`${name} contains an invalid domain: ${item}`);
    if (!seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
  }
  return domains;
}

function normalizeDomain(value) {
  const candidate = value.trim().toLowerCase().replace(/^\*\./u, '');
  if (!candidate || candidate.length > 253 || candidate.includes('/') || candidate.includes(':')) return null;
  try {
    const url = new URL(`https://${candidate}`);
    return url.hostname === candidate && url.pathname === '/' ? url.hostname : null;
  } catch {
    return null;
  }
}

function optionalEnum(value, allowed, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function objectRecord(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
