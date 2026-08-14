import {
  RUNTIME_LOCAL_ATTACHMENT_LINK_PATH,
  isRuntimeStoredMessageAttachment,
  isRuntimeRasterImageMimeType,
  type RuntimeAttachmentLinkInput,
} from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { RuntimeAttachmentValidationError } from '../ports/attachment-store.js';
import { assertSafeRuntimeId } from '../security/runtime-id.js';
import { detectSafeImageMimeType } from '../utils/safe-image.js';
import { RuntimeHttpError } from './http-error.js';
import { decodeRuntimeId, readBinaryBody, readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

// Local files bypass this route entirely. Keep only the pathless managed-image
// fallback bounded so a synthetic renderer payload cannot exhaust the runtime.
const MAX_MANAGED_ATTACHMENT_BODY_BYTES = 256 * 1024 * 1024;

export async function handleRuntimeResourceRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'POST' && url.pathname === RUNTIME_LOCAL_ATTACHMENT_LINK_PATH) {
    const input = await readBody<Partial<RuntimeAttachmentLinkInput>>(request);
    try {
      sendJson(response, 201, await runtime.attachmentStore.link({
        path: typeof input.path === 'string' ? input.path : '',
        type: typeof input.type === 'string' ? input.type : '',
      }));
    } catch (error) {
      if (!(error instanceof RuntimeAttachmentValidationError)) throw error;
      throw new RuntimeHttpError(400, error.message, error.code);
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/attachments') {
    const name = url.searchParams.get('name') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const data = await readBinaryBody(request, MAX_MANAGED_ATTACHMENT_BODY_BYTES);
    try {
      sendJson(response, 201, await runtime.attachmentStore.create({ name, type, data }));
    } catch (error) {
      if (!(error instanceof RuntimeAttachmentValidationError)) throw error;
      const statusCode = error.code === 'attachment_unsupported' ? 415 : 400;
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
        && isRuntimeRasterImageMimeType(item.type)
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
      || data.byteLength !== resolved.attachment.size
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
