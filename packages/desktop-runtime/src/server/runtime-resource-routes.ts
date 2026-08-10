import {
  RUNTIME_FILE_ATTACHMENT_MAX_BYTES,
  isRuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { RuntimeAttachmentValidationError } from '../ports/attachment-store.js';
import { assertSafeRuntimeId } from '../security/runtime-id.js';
import { detectSafeImageMimeType } from '../utils/safe-image.js';
import { RuntimeHttpError } from './http-error.js';
import { decodeRuntimeId, readBinaryBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeResourceRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'POST' && url.pathname === '/v1/attachments') {
    const name = url.searchParams.get('name') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const data = await readBinaryBody(request, RUNTIME_FILE_ATTACHMENT_MAX_BYTES);
    try {
      sendJson(response, 201, await runtime.attachmentStore.create({ name, type, data }));
    } catch (error) {
      if (!(error instanceof RuntimeAttachmentValidationError)) throw error;
      const statusCode = error.code === 'attachment_too_large'
        ? 413
        : error.code === 'attachment_unsupported'
          ? 415
          : 400;
      throw new RuntimeHttpError(statusCode, error.message, error.code);
    }
    return true;
  }

  const threadImageMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/attachments\/([^/]+)\/image$/u);
  if (threadImageMatch && request.method === 'GET') {
    const threadId = decodeRuntimeId(threadImageMatch[1], 'Thread id');
    const assetId = decodeRuntimeId(threadImageMatch[2], 'Attachment id');
    const thread = await runtime.threadStore.getThread(threadId);
    const attachment = thread?.messages
      .flatMap((message) => message.attachments ?? [])
      .find((item) => (
        isRuntimeStoredMessageAttachment(item)
        && item.assetId === assetId
        && item.type.startsWith('image/')
      ));
    if (!attachment) {
      throw new RuntimeHttpError(404, 'Image attachment not found', 'attachment_not_found');
    }
    const resolved = (await runtime.attachmentStore.resolveForThread(threadId, [attachment]))[0];
    if (!resolved) {
      throw new RuntimeHttpError(404, 'Image attachment not found', 'attachment_not_found');
    }
    const data = await readFile(resolved.absolutePath).catch(() => null);
    const mimeType = data ? detectSafeImageMimeType(data) : null;
    if (!data
      || !data.byteLength
      || data.byteLength !== attachment.size
      || data.byteLength > RUNTIME_FILE_ATTACHMENT_MAX_BYTES
      || mimeType !== attachment.type) {
      throw new RuntimeHttpError(415, 'Image attachment is unavailable', 'attachment_invalid');
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': data.byteLength,
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(data);
    return true;
  }

  const attachmentMatch = url.pathname.match(/^\/v1\/attachments\/([^/]+)$/u);
  if (attachmentMatch && request.method === 'DELETE') {
    const assetId = assertSafeRuntimeId(
      decodeURIComponent(attachmentMatch[1]),
      'Attachment id',
    );
    sendJson(response, 200, {
      deleted: await runtime.attachmentStore.deletePending(assetId),
    });
    return true;
  }

  return false;
}
