import path from 'node:path';

export function normalizePluginId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  if (!id) throw new Error('Plugin id is required.');
  return id;
}

export function normalizeSkillId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  if (!id) throw new Error('Plugin skill directory requires a valid id.');
  return id;
}

export function normalizeMcpKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!key) throw new Error('Plugin MCP key is required.');
  return key;
}

export function normalizeResourceId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100);
  if (!id) throw new Error('Plugin resource id is required.');
  return id;
}

export function normalizeHookId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100);
  if (!id) throw new Error('Plugin Hook requires a valid id.');
  return id;
}

export function skillMetadata(content: string, fallback: string): { name: string; description?: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
  if (frontmatter === undefined) return { name: fallback };
  const lines = frontmatter.split(/\r?\n/u);
  const name = frontmatterText(lines, 'name') || fallback;
  const description = frontmatterText(lines, 'description');
  return { name, ...(description ? { description } : {}) };
}

export function frontmatterText(lines: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  const line = lines.find((item) => item.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^['"]|['"]$/gu, '') || undefined;
}

export function textMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.json': return 'application/json';
    case '.yaml':
    case '.yml': return 'application/yaml';
    case '.md': return 'text/markdown';
    case '.html': return 'text/html';
    case '.css': return 'text/css';
    case '.js':
    case '.mjs':
    case '.ts': return 'text/javascript';
    default: return 'text/plain';
  }
}

export function binaryMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

export function optionalTextFields(record: Record<string, unknown>): { version?: string; description?: string } {
  const version = optionalString(record.version);
  const description = optionalString(record.description);
  return { ...(version ? { version } : {}), ...(description ? { description } : {}) };
}

export function optionalMarketplaceFields(record: Record<string, unknown>): {
  icon?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
  featuredOrder?: number;
} {
  const icon = normalizePluginIcon(record.icon);
  const publisher = optionalString(record.publisher);
  const featured = record.featured === true;
  const featuredOrder = optionalFeaturedOrder(record.featuredOrder ?? record.featured_order);
  if (!featured && featuredOrder !== undefined) {
    throw new Error('Plugin featuredOrder requires featured: true.');
  }
  return {
    ...(icon ? { icon } : {}),
    ...(publisher ? { publisher } : {}),
    tags: stringArray(record.tags, 'Plugin tags'),
    featured,
    ...(featuredOrder !== undefined ? { featuredOrder } : {}),
  };
}

export function optionalFeaturedOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Plugin featuredOrder must be a positive integer.');
  }
  return value;
}

export function normalizePluginIcon(value: unknown): string | undefined {
  const icon = optionalString(value);
  if (!icon) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(icon)) {
    throw new Error('Plugin icon must be a lowercase renderer icon token.');
  }
  return icon;
}

export function objectRecord(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Plugin timeout values must be positive numbers.');
  return Math.floor(value);
}

export function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

export function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
