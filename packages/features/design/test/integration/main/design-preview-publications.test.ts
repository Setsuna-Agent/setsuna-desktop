import { request } from 'node:http';
import { expect, it } from 'vitest';
import type { DesignPreviewLayer } from '../../../src/contracts/design-preview-layers.js';
import { parseBeginDesignPreview, type BeginDesignPreview } from '../../../src/contracts/design-publication.js';
import { DesignPreviewPublications } from '../../../src/main/publication/design-preview-publications.js';

const binding = { id: 'loopback', address: '127.0.0.1' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const layer: DesignPreviewLayer = { kind: 'artboard', bounds: [0, 0, 1, 1], rotation: 0, opacity: 1,
  outline: [[0, 0], [1, 0], [1, 1], [0, 1]], fills: [], strokes: [], children: [] };
const input: BeginDesignPreview = {
  ref: { storageId: 'local', path: 'screen.design.json' }, documentId: 'screen', revision: '1'.repeat(64), access: { kind: 'link' },
  boards: [
    { name: 'Overview', width: 1, height: 1, layers: { ...layer, name: 'Overview', bounds: [-50, 30, 120, 50] } },
    { name: 'Detail', width: 1, height: 1, flipX: true, layers: { ...layer, name: 'Detail', bounds: [280, 10, 80, 120], rotation: 90 } },
  ], start: 1,
};
const signal = new AbortController().signal;
const owner = 1;

function readPreview(url: string, pathname: string, options?: {
  headers?: Record<string, string>; method?: string; authorized?: boolean; body?: string;
}) {
  const link = new URL(url);
  return new Promise<{ status: number; body: Buffer; cache?: string; cors?: string; access?: string }>((resolve, reject) => {
    const headers = {
      ...(options?.authorized === false ? {} : { Authorization: 'Bearer ' + link.hash.slice(1) }),
      ...(options?.body === undefined ? {} : { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(Buffer.byteLength(options.body)) }),
      ...options?.headers,
    };
    const pending = request(new URL(pathname, link.origin), { agent: false, headers, method: options?.method ?? 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks),
        cache: response.headers['cache-control'], cors: response.headers['access-control-allow-origin'],
        access: response.headers['x-design-preview-access'] as string | undefined }));
    });
    pending.on('error', reject);
    pending.end(options?.body);
  });
}

function append(service: DesignPreviewPublications, ticket: string, index: number) {
  service.append(owner, ticket, index, Uint8Array.from(png).buffer);
}

it('serves only the authorized published artboards and rejects unrelated routes, cross-origin access and writes', async () => {
  const service = new DesignPreviewPublications(() => [binding]);
  try {
    const ticket = service.begin(owner, input, signal);
    append(service, ticket, 0);
    await expect(service.publish(owner, ticket, signal)).rejects.toThrow('incomplete');
    expect(service.status()).toBeNull();
    append(service, ticket, 1);
    const release = await service.publish(owner, ticket, signal);
    const [url] = release.urls;
    const link = new URL(url);
    expect(link.search).toBe('');
    const page = await readPreview(url, '/', { authorized: false });
    expect(page.status).toBe(200);
    expect(page.body.toString()).not.toContain(input.boards[0].name);
    const response = await readPreview(url, '/api/boards');
    expect(response).toMatchObject({ status: 200, cache: 'no-store', cors: undefined });
    expect(JSON.parse(response.body.toString())).toEqual({ boards: input.boards, start: input.start });
    for (const index of [0, 1]) {
      await expect(readPreview(url, `/api/boards/${index}.png`)).resolves.toMatchObject({ status: 200, body: png });
    }
    await expect(readPreview(url, '/api/boards/2.png')).resolves.toMatchObject({ status: 404 });
    await expect(readPreview(url, '/v1/features/design/documents')).resolves.toMatchObject({ status: 404 });
    await expect(readPreview(url, '/api/boards', { authorized: false })).resolves.toMatchObject({ status: 401, body: Buffer.alloc(0) });
    await expect(readPreview(url, '/api/boards', { headers: { Authorization: 'Bearer invalid' } })).resolves.toMatchObject({ status: 401 });
    await expect(readPreview(url, '/api/boards', { headers: { Host: 'unrelated.local' } })).resolves.toMatchObject({ status: 403 });
    await expect(readPreview(url, '/api/boards', { headers: { Origin: 'http://unrelated.local' } })).resolves.toMatchObject({ status: 403 });
    await expect(readPreview(url, '/api/boards', { method: 'POST' })).resolves.toMatchObject({ status: 405 });
    await expect(readPreview(url, '/api/unlock', { method: 'POST', body: 'a password' })).resolves.toMatchObject({ status: 405 });
    await service.stop(release.id);
    await expect(readPreview(url, '/api/boards')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  } finally { await service.dispose(); }
});

it('keeps the previous release available until replacement succeeds and revokes it and the replacement independently', async () => {
  let available = true;
  const service = new DesignPreviewPublications(() => available ? [binding] : []);
  try {
    const first = service.begin(owner, input, signal);
    append(service, first, 0);
    append(service, first, 1);
    const original = await service.publish(owner, first, signal);
    const updated = { ...input, revision: '2'.repeat(64), start: 0 };
    const failed = service.begin(owner, updated, signal);
    append(service, failed, 0);
    await expect(service.publish(owner, failed, signal)).rejects.toThrow('incomplete');
    service.cancel(owner, failed);
    await expect(readPreview(original.urls[0], '/api/boards/1.png')).resolves.toMatchObject({ status: 200 });

    const next = service.begin(owner, updated, signal);
    append(service, next, 0);
    append(service, next, 1);
    const replacement = await service.publish(owner, next, signal);
    expect(replacement.urls).not.toEqual(original.urls);
    await expect(readPreview(original.urls[0], '/api/boards')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(JSON.parse((await readPreview(replacement.urls[0], '/api/boards')).body.toString()).start).toBe(0);

    available = false;
    expect(service.status()).toBeNull();
    await expect(readPreview(replacement.urls[0], '/api/boards')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  } finally { await service.dispose(); }
});

it('requires all declared mode frames and serves them only after the publication password is unlocked', async () => {
  const service = new DesignPreviewPublications(() => [binding]);
  const password = 'Design review';
  const variables = {
    collections: [{ name: 'Palette', modes: ['Light', 'Dark'] }],
    entries: [{ collection: 0, name: 'Surface', kind: 'color', cells: [{ value: '#ffffff' }, { value: '#222222' }] }],
  };
  const preview = parseBeginDesignPreview({ ...input, variables, access: { kind: 'password', password }, boards: [
    { ...input.boards[0], modes: { initial: [1], axes: [{ collection: 0, modes: [0, 1] }] } },
    { ...input.boards[1], modes: { initial: [0], axes: [] } },
  ] });
  const frame = { width: 1, height: 1, layers: { ...layer, fills: ['#ffffff'] } };
  const bitmap = Uint8Array.from(png).buffer;
  try {
    const ticket = service.begin(owner, preview, signal);
    append(service, ticket, 0);
    append(service, ticket, 1);
    expect(() => service.appendVariant(owner, ticket, 0, 1, frame, bitmap)).toThrow('Invalid preview variant');
    await expect(service.publish(owner, ticket, signal)).rejects.toThrow('incomplete');
    service.appendVariant(owner, ticket, 0, 0, { ...frame, layers: { ...frame.layers, context: 'private' } }, bitmap);
    const { urls: [url] } = await service.publish(owner, ticket, signal);
    for (const path of ['/api/boards', '/api/boards/0/0.json', '/api/boards/0/0.png']) {
      await expect(readPreview(url, path)).resolves.toMatchObject({ status: 401, body: Buffer.alloc(0) });
    }
    const unlocked = await readPreview(url, '/api/unlock', { method: 'POST', body: password });
    const { token } = JSON.parse(unlocked.body.toString()) as { token: string };
    const headers = { Authorization: 'Bearer ' + token };
    const layout = await readPreview(url, '/api/boards', { headers });
    expect(JSON.parse(layout.body.toString()).variables).toEqual(variables);
    const metadata = await readPreview(url, '/api/boards/0/0.json', { headers });
    expect(JSON.parse(metadata.body.toString())).toEqual(frame);
    await expect(readPreview(url, '/api/boards/0/0.png', { headers })).resolves.toMatchObject({ status: 200, body: png });
    await expect(readPreview(url, '/api/boards/1/0.png', { headers })).resolves.toMatchObject({ status: 404 });
  } finally { await service.dispose(); }
});

it('requires unlocking at every published address before returning any artboard data', async () => {
  const service = new DesignPreviewPublications(() => [binding, { id: 'loopback-v6', address: '::1' }]);
  const password = '评审图🔒';
  try {
    const untrustedBoards = input.boards.map((board) => ({ ...board, layers: { ...board.layers, context: 'private context',
      children: [{ ...layer, kind: 'web', url: 'http://private.local/', context: 'private child context' }] } }));
    const ticket = service.begin(owner, parseBeginDesignPreview({ ...input, boards: untrustedBoards, access: { kind: 'password', password } }), signal);
    append(service, ticket, 0);
    append(service, ticket, 1);
    const release = await service.publish(owner, ticket, signal);
    const links = release.urls.map((url) => new URL(url));
    expect(links.map(({ hostname }) => hostname)).toEqual(['127.0.0.1', '[::1]']);
    expect(new Set(links.map(({ port, hash }) => port + hash)).size).toBe(1);
    expect(JSON.stringify(release)).not.toContain(password);
    for (const url of release.urls) {
      await expect(readPreview(url, '/api/boards')).resolves.toMatchObject({ status: 401, access: 'password', body: Buffer.alloc(0) });
      await expect(readPreview(url, '/api/boards/0.png')).resolves.toMatchObject({ status: 401, body: Buffer.alloc(0) });
    }
    const url = release.urls[0];
    await expect(readPreview(url, '/api/boards', { headers: { Host: links[1].host } })).resolves.toMatchObject({ status: 403 });
    await expect(readPreview(url, '/api/unlock', { method: 'POST', body: password, authorized: false })).resolves.toMatchObject({ status: 401 });
    await expect(readPreview(url, '/api/unlock', { method: 'POST', body: password, headers: { Origin: 'http://unrelated.local' } }))
      .resolves.toMatchObject({ status: 403 });
    await expect(readPreview(url, '/api/unlock', { method: 'POST', body: 'wrong' })).resolves.toMatchObject({ status: 401, body: Buffer.alloc(0) });
    const unlocked = await readPreview(url, '/api/unlock', { method: 'POST', body: password, headers: { Origin: links[0].origin } });
    expect(unlocked).toMatchObject({ status: 200, cache: 'no-store' });
    const { token } = JSON.parse(unlocked.body.toString()) as { token: string };
    expect(token).not.toBe(links[0].hash.slice(1));
    for (const address of release.urls) {
      const headers = { Authorization: 'Bearer ' + token };
      const layout = await readPreview(address, '/api/boards', { headers });
      expect(layout.status).toBe(200);
      expect(JSON.parse(layout.body.toString())).toEqual({
        start: input.start, boards: input.boards.map((board) => ({ ...board, layers: { ...board.layers, children: [{ ...layer, kind: 'web' }] } })),
      });
      await expect(readPreview(address, '/api/boards/1.png', { headers })).resolves.toMatchObject({ status: 200, body: png });
    }
    await expect(readPreview(url, '/api/boards')).resolves.toMatchObject({ status: 401 });
  } finally { await service.dispose(); }
});
