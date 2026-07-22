import { createServer } from 'node:http';

import {
  readRequestText
} from './shared.js';

export async function createOpenAiDynamicToolServer(): Promise<{
  baseUrl: string;
  requests: Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}> {
  const requests: Record<string, unknown>[] = [];
  let resolveRequests: (requests: Record<string, unknown>[]) => void = () => undefined;
  let rejectRequests: (error: unknown) => void = () => undefined;
  const requestsPromise = new Promise<Record<string, unknown>[]>((resolve, reject) => {
    resolveRequests = resolve;
    rejectRequests = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = JSON.parse(await readRequestText(request)) as Record<string, unknown>;
      requests.push(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      if (requests.length === 1) {
        response.write(`data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_dynamic_1',
                    type: 'function',
                    function: {
                      name: 'tickets__lookup_ticket',
                      arguments: '{"id":"ABC-123"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })}\n\n`);
      } else {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Dynamic tool result received.' } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        resolveRequests([...requests]);
      }
      response.write('data: [DONE]\n\n');
      response.end();
    } catch (error) {
      rejectRequests(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for dynamic tool server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: requestsPromise,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}