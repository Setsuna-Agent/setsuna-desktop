import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SendTurnInput, ThreadQuery } from '@setsuna-desktop/contracts';
import { RuntimeHttpError } from './http-error.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

export async function readBody<T = unknown>(request: IncomingMessage, fallback?: T): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new RuntimeHttpError(413, 'Request body too large', 'body_too_large');
    chunks.push(buffer);
  }
  if (!chunks.length) {
    if (fallback !== undefined) return fallback;
    return {} as T;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch (error) {
    throw new RuntimeHttpError(400, error instanceof Error ? `Invalid JSON body: ${error.message}` : 'Invalid JSON body', 'invalid_json');
  }
}

export async function readBinaryBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RuntimeHttpError(413, 'Attachment is too large', 'attachment_too_large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new RuntimeHttpError(413, 'Attachment is too large', 'attachment_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function optionalNumber(value: string | null): number | undefined {
  if (value === null || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function memoryScope(value: string | null): 'global' | 'project' | undefined {
  if (value === 'global' || value === 'project') return value;
  return undefined;
}

export function threadScope(value: string | null): ThreadQuery['scope'] {
  if (value === 'all' || value === 'global' || value === 'project') return value;
  return undefined;
}

export function isRuntimeMessageAttachment(value: unknown): value is NonNullable<SendTurnInput['attachments']>[number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const baseValid = (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.size === 'number' &&
    Number.isFinite(record.size)
  );
  if (!baseValid) return false;
  if (record.source === 'runtime') return typeof record.assetId === 'string' && Boolean(record.assetId.trim());
  if (record.source !== undefined && record.source !== 'inline') return false;
  return typeof record.url === 'string' && Boolean(record.url.trim());
}
