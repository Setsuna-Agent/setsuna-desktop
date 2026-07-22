import { createServer, type IncomingMessage } from 'node:http';



export type RuntimeEventStream = {
  readContains(needle: string, options?: { timeoutMs?: number }): Promise<boolean>;
  close(): Promise<void>;
};

export type AppServerStreamNotification = {
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
};

export function persistentPtyScript(label: string): string {
  return [
    'process.stdin.setEncoding("utf8");',
    'process.stdout.write(`tty:${process.stdin.isTTY === true}\\n`);',
    `process.stdout.write(${JSON.stringify(`ready:${label}\n`)});`,
    'process.on("SIGHUP", () => process.exit(0));',
    'process.on("SIGTERM", () => process.exit(0));',
    'process.on("SIGINT", () => process.exit(0));',
    'setInterval(() => {}, 1000);',
  ].join('\n');
}

export function persistentOutputScript(label: string): string {
  return [
    `process.stdout.write(${JSON.stringify(`ready:${label}\n`)});`,
    'process.on("SIGTERM", () => process.exit(143));',
    'process.on("SIGINT", () => process.exit(130));',
    'setInterval(() => {}, 1000);',
  ].join('\n');
}

export async function createOpenAiCaptureServer(responseText = 'Captured.'): Promise<{
  baseUrl: string;
  nextBody: Promise<Record<string, unknown>>;
  close(): Promise<void>;
}> {
  let resolveBody: (body: Record<string, unknown>) => void = () => undefined;
  let rejectBody: (error: unknown) => void = () => undefined;
  const nextBody = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveBody = resolve;
    rejectBody = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      resolveBody(JSON.parse(await readRequestText(request)) as Record<string, unknown>);
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      if (responseText) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: responseText } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    } catch (error) {
      rejectBody(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for capture server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextBody,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export async function createDelayedOpenAiCaptureServer(): Promise<{
  baseUrl: string;
  nextBody: Promise<Record<string, unknown>>;
  release(): void;
  close(): Promise<void>;
}> {
  let resolveBody: (body: Record<string, unknown>) => void = () => undefined;
  let rejectBody: (error: unknown) => void = () => undefined;
  let releaseResponse: () => void = () => undefined;
  const nextBody = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveBody = resolve;
    rejectBody = reject;
  });
  const released = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      resolveBody(JSON.parse(await readRequestText(request)) as Record<string, unknown>);
      await released;
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Released.' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    } catch (error) {
      rejectBody(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for delayed capture server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextBody,
    release: releaseResponse,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(message);
    }),
  ]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

