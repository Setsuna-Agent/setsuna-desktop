import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import type { McpToolCallResponse } from '../../ports/mcp-client-runtime.js';
import type { ToolExecutionContext, ToolExecutionResult } from '../../ports/tool-host.js';

const MAX_MODEL_TEXT_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_TREE_DEPTH = 8;
const SAFE_IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export function mcpToolExecutionResult(
  response: McpToolCallResponse,
  context: ToolExecutionContext,
  serverKey: string,
  toolName: string,
): ToolExecutionResult {
  const textParts: string[] = [];
  const attachments: RuntimeMessageAttachment[] = [];

  response.content.forEach((item, index) => {
    const type = stringValue(item.type);
    if (type === 'text') {
      appendText(textParts, stringValue(item.text));
      return;
    }
    if (type === 'resource_link') {
      const uri = stringValue(item.uri);
      const name = stringValue(item.name) || uri;
      appendText(textParts, `[MCP resource link] ${name}${uri && uri !== name ? `: ${uri}` : ''}`);
      return;
    }
    if (type === 'resource') {
      const resource = recordInput(item.resource);
      if (typeof resource.text === 'string') {
        const uri = stringValue(resource.uri);
        appendText(textParts, `${uri ? `[MCP resource ${uri}]\n` : ''}${resource.text}`);
        return;
      }
      const attachment = imageAttachment(
        resource.blob,
        resource.mimeType,
        context,
        serverKey,
        toolName,
        index,
      );
      if (attachment) attachments.push(attachment);
      else appendText(textParts, binaryContentSummary('resource', resource.mimeType, resource.uri));
      return;
    }
    if (type === 'image') {
      const attachment = imageAttachment(item.data, item.mimeType, context, serverKey, toolName, index);
      if (attachment) attachments.push(attachment);
      else appendText(textParts, binaryContentSummary('image', item.mimeType));
      return;
    }
    if (type === 'audio') {
      appendText(textParts, binaryContentSummary('audio', item.mimeType));
      return;
    }
    appendText(textParts, stringifyResult(sanitizeMcpValue(item)));
  });

  if (!textParts.length && response.structuredContent !== undefined) {
    appendText(textParts, stringifyResult(sanitizeMcpValue(response.structuredContent)));
  }
  const content = truncateUtf8(textParts.filter(Boolean).join('\n'), MAX_MODEL_TEXT_BYTES)
    || (attachments.length ? `MCP tool returned ${attachments.length} image attachment(s).` : 'MCP tool returned no content.');

  return {
    content,
    ...(attachments.length ? { attachments } : {}),
    preview: content.slice(0, 2_000),
    containsExternalContext: true,
    data: {
      serverKey,
      toolName,
      result: sanitizeMcpValue(response),
    },
  };
}

function imageAttachment(
  rawData: unknown,
  rawMimeType: unknown,
  context: ToolExecutionContext,
  serverKey: string,
  toolName: string,
  index: number,
): RuntimeMessageAttachment | null {
  if (context.modelCapabilities?.supportsImages !== true) return null;
  const data = typeof rawData === 'string' ? rawData.replace(/\s+/g, '') : '';
  const mimeType = stringValue(rawMimeType).toLowerCase();
  if (!data || !SAFE_IMAGE_MIME_TYPES.has(mimeType) || !isBase64(data)) return null;
  const size = Buffer.byteLength(data, 'base64');
  if (!size || size > MAX_IMAGE_BYTES) return null;
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
  const idPart = safeNamePart(context.toolCallId ?? `${Date.now()}_${index}`);
  return {
    id: `mcp_${safeNamePart(serverKey)}_${idPart}`,
    name: `${safeNamePart(serverKey)}-${safeNamePart(toolName)}-${index + 1}.${extension}`,
    type: mimeType,
    size,
    url: `data:${mimeType};base64,${data}`,
  };
}

function binaryContentSummary(kind: string, mimeType: unknown, uri?: unknown): string {
  const type = stringValue(mimeType) || 'unknown MIME type';
  const location = stringValue(uri);
  return `[MCP ${kind} omitted: ${type}${location ? `, ${location}` : ''}]`;
}

function sanitizeMcpValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DATA_TREE_DEPTH) return '[nested MCP data omitted]';
  if (Array.isArray(value)) return value.map((item) => sanitizeMcpValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const type = stringValue(record.type);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => {
    if ((key === 'data' && (type === 'image' || type === 'audio')) || key === 'blob') {
      return [key, typeof item === 'string' ? `[base64 omitted: ${item.length} characters]` : '[binary omitted]'];
    }
    return [key, sanitizeMcpValue(item, depth + 1)];
  }));
}

function appendText(parts: string[], value: string): void {
  const text = value.trim();
  if (text) parts.push(text);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n[MCP content truncated]`;
}

function isBase64(value: string): boolean {
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) return false;
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function safeNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'content';
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
