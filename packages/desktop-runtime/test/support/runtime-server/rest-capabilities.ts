import { createServer } from 'node:http';

import {
  readRequestText
} from './shared.js';

export const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function createImageGenerationCaptureServer(): Promise<{
  baseUrl: string;
  nextRequest: Promise<{ authorization: string; path: string; body: Record<string, unknown> }>;
  close(): Promise<void>;
}> {
  let resolveRequest: (request: { authorization: string; path: string; body: Record<string, unknown> }) => void = () => undefined;
  let rejectRequest: (error: unknown) => void = () => undefined;
  const nextRequest = new Promise<{ authorization: string; path: string; body: Record<string, unknown> }>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      const body = JSON.parse(await readRequestText(request)) as Record<string, unknown>;
      resolveRequest({
        authorization: String(request.headers.authorization ?? ''),
        path: request.url ?? '',
        body,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG_BASE64 }] }));
    } catch (error) {
      rejectRequest(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for image generation server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextRequest,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}