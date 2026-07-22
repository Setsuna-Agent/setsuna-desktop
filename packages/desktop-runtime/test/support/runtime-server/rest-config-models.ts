import { createServer } from 'node:http';


export async function createModelListCaptureServer(): Promise<{
  baseUrl: string;
  nextRequest: Promise<{ authorization?: string; url?: string }>;
  close(): Promise<void>;
}> {
  let resolveRequest: (request: { authorization?: string; url?: string }) => void = () => undefined;
  const nextRequest = new Promise<{ authorization?: string; url?: string }>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((request, response) => {
    resolveRequest({
      authorization: request.headers.authorization,
      url: request.url,
    });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      data: [
        { id: 'llama3.1', display_name: 'Llama 3.1' },
        { model: 'qwen2.5', max_tokens: 8192, capabilities: { reasoning: true, reasoningEfforts: ['low', 'high'] }, modalities: ['text', 'image'] },
        { id: 'llama3.1', name: 'Duplicate' },
      ],
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for model list server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextRequest,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}