import { RUNTIME_FILE_ATTACHMENT_MAX_BYTES } from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { RuntimeAttachmentValidationError } from '../ports/attachment-store.js';
import { assertSafeRuntimeId } from '../security/runtime-id.js';
import { RuntimeHttpError } from './http-error.js';
import { readBinaryBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeResourceRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'POST' && url.pathname === '/v1/data-migration/prepare') {
    sendJson(response, 200, runtime.agentLoop.prepareDataMigration());
    return true;
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/data-migration/prepare') {
    runtime.agentLoop.cancelDataMigrationPreparation();
    sendJson(response, 200, { ok: true });
    return true;
  }

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
