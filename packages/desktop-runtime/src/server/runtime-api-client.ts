import { parseRuntimeApiRequest, RUNTIME_API_MAX_BYTES, type RuntimeApiResponse } from '@setsuna-desktop/contracts';
import { installLocalPlugin } from '@setsuna-desktop/feature-plugin-management/contracts';
import type { RuntimeApi } from '../ports/runtime-api.js';
import type { DesktopNativeBridge } from '../ports/secret-store.js';
import { decodeRuntimeId } from './http-utils.js';

/** Reuses backend routes while preserving operations that require desktop coordination. */
export function createRuntimeApiClient(options: {
  baseUrl(): string;
  token: string;
  deleteThread?: DesktopNativeBridge['deleteThread'];
}): RuntimeApi {
  return {
    async request(value, signal): Promise<RuntimeApiResponse> {
      const input = parseRuntimeApiRequest(value);
      const pathname = new URL(input.path, 'http://runtime.local').pathname;
      if (pathname === installLocalPlugin.path) {
        throw new Error('Local plugin import requires the desktop native directory picker.');
      }
      if (/\/renderer-ui\/runtime-request$/u.test(pathname)) {
        throw new Error('Runtime API requests cannot target the runtime bridge itself.');
      }
      // The RPC alias must not bypass the same cross-window deletion checks.
      if (pathname === '/v1/swe/app-server' && input.method === 'POST'
        && (input.body as { method?: unknown } | null)?.method === 'thread/delete') {
        throw new Error('Use DELETE /v1/threads/:id for coordinated conversation deletion.');
      }
      const requestSignal = AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]);
      requestSignal.throwIfAborted();
      const threadMatch = input.method === 'DELETE' && pathname.match(/^\/v1\/threads\/([^/]+)$/u);
      if (threadMatch) {
        if (!options.deleteThread) throw new Error('Deleting a conversation requires the Setsuna Desktop host.');
        const data = await options.deleteThread(decodeRuntimeId(threadMatch[1], 'Thread id'), requestSignal);
        return { ok: !data.cancelled, status: data.cancelled ? 409 : 200, data };
      }
      const response = await fetch(`${options.baseUrl()}${input.path}`, {
        method: input.method,
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        redirect: 'error',
        signal: requestSignal,
      });
      const mimeType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
      if (mimeType === 'text/event-stream') {
        await response.body?.cancel();
        throw new Error('Use the JSON event-history endpoint for runtime events.');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      try {
        if (reader) for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > RUNTIME_API_MAX_BYTES) throw new Error('Runtime API response is too large; request a smaller page.');
          chunks.push(chunk.value);
        }
      } finally {
        await reader?.cancel();
      }
      const buffer = Buffer.concat(chunks);
      const data: unknown = !buffer.length ? null
        : mimeType === 'application/json' ? JSON.parse(buffer.toString('utf8'))
          : mimeType.startsWith('text/') ? buffer.toString('utf8')
            : { mimeType, base64: buffer.toString('base64') };
      return { ok: response.ok, status: response.status, data };
    },
  };
}
