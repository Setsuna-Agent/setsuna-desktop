import path from 'node:path';

export class MemoryWebDavServer {
  readonly directories = new Set<string>();
  readonly files = new Map<string, Buffer>();
  readonly requests: Array<{ method: string; path: string }> = [];
  readonly fetch: typeof globalThis.fetch;

  constructor(
    endpointPath = '/dav',
    private readonly username = 'alice',
    private readonly password = 'secret',
  ) {
    this.directories.add(normalizePath(endpointPath));
    this.fetch = this.handleFetch.bind(this) as typeof globalThis.fetch;
  }

  private async handleFetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const requestPath = normalizePath(decodeURIComponent(url.pathname));
    this.requests.push({ method, path: requestPath });
    const authorization = new Headers(init?.headers).get('authorization');
    const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64')}`;
    if (authorization !== expected) return new Response(null, { status: 401 });

    if (method === 'MKCOL') {
      if (this.directories.has(requestPath)) return new Response(null, { status: 405 });
      if (!this.directories.has(parentPath(requestPath))) return new Response(null, { status: 409 });
      this.directories.add(requestPath);
      return new Response(null, { status: 201 });
    }
    if (method === 'PUT') {
      if (!this.directories.has(parentPath(requestPath))) return new Response(null, { status: 409 });
      if (new Headers(init?.headers).get('if-none-match') === '*' && this.files.has(requestPath)) {
        return new Response(null, { status: 412 });
      }
      this.files.set(requestPath, await bodyBuffer(init?.body));
      return new Response(null, { status: 201 });
    }
    if (method === 'GET') {
      const data = this.files.get(requestPath);
      return data
        ? new Response(data, { status: 200, headers: { 'Content-Length': String(data.byteLength) } })
        : new Response(null, { status: 404 });
    }
    if (method === 'PROPFIND') {
      if (!this.directories.has(requestPath) && !this.files.has(requestPath)) {
        return new Response(null, { status: 404 });
      }
      const depth = new Headers(init?.headers).get('depth') ?? '0';
      return new Response(this.propfindXml(requestPath, depth === '1'), {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
    if (method === 'DELETE') {
      if (!this.directories.has(requestPath) && !this.files.has(requestPath)) {
        return new Response(null, { status: 404 });
      }
      this.files.delete(requestPath);
      for (const filePath of [...this.files.keys()]) {
        if (filePath.startsWith(`${requestPath}/`)) this.files.delete(filePath);
      }
      for (const directoryPath of [...this.directories]) {
        if (directoryPath === requestPath || directoryPath.startsWith(`${requestPath}/`)) {
          this.directories.delete(directoryPath);
        }
      }
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }

  private propfindXml(requestPath: string, includeChildren: boolean): string {
    const entries: Array<{ value: string; collection: boolean }> = [{
      value: requestPath,
      collection: this.directories.has(requestPath),
    }];
    if (includeChildren && this.directories.has(requestPath)) {
      for (const directory of this.directories) {
        if (directory !== requestPath && parentPath(directory) === requestPath) {
          entries.push({ value: directory, collection: true });
        }
      }
      for (const file of this.files.keys()) {
        if (parentPath(file) === requestPath) entries.push({ value: file, collection: false });
      }
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${entries.map((entry) => `<d:response><d:href>${xmlEscape(entry.value)}${entry.collection ? '/' : ''}</d:href><d:propstat><d:prop><d:resourcetype>${entry.collection ? '<d:collection />' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`).join('\n')}
</d:multistatus>`;
  }
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
  return normalized || '/';
}

function parentPath(value: string): string {
  return normalizePath(path.posix.dirname(value));
}

async function bodyBuffer(body: RequestInit['body']): Promise<Buffer> {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
  throw new Error('Unsupported test request body.');
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value);
}

function xmlEscape(value: string): string {
  return encodeURI(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
