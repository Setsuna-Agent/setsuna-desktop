import type { RuntimeRequestInput } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { expect, it, vi } from 'vitest';
import { createDesktopFeatureOperationTransport } from '../../../src/composition/desktop-feature-operation-transport.js';
import { readGitConflictHistory } from '@setsuna-desktop/feature-review/contracts';
import { createReviewClient } from '../../../../../../packages/features/review/src/renderer/client.js';
import { createDesignClient, type DesignAssets } from '../../../../../../packages/features/design/src/renderer/client.js';
import { deleteDesignDocument } from '@setsuna-desktop/feature-design/contracts';
import { removeDesignFont } from '../../../../../../packages/features/design/src/contracts/design-fonts.js';
import { designCommandFromQuery } from '../../../../../../packages/features/design/src/contracts/design-command-key.js';

const input = { threadId: 'thread/一', workspaceRoot: 'C:\\项目 + #1&test\\repo', limit: 0, archived: false, omitted: undefined };
const codec = defineRuntimeCodec((value) => value);
function setup() {
  const request = vi.fn<(input: RuntimeRequestInput) => Promise<unknown>>().mockResolvedValue({ ok: true, value: [] });
  return { request, transport: createDesktopFeatureOperationTransport({ request: async <T>(input: RuntimeRequestInput) => await request(input) as T, cancelRequest: vi.fn() }) };
}

it('delivers the workspace unchanged from the Review client through the bridge to the runtime input codec', async () => {
  const { request, transport } = setup();
  request.mockImplementation(async (sent) => {
    const url = new URL(sent.path, 'http://localhost');
    expect(url.pathname).toBe(readGitConflictHistory.path);
    expect(sent.method).toBe(readGitConflictHistory.method);
    expect(sent.body).toBeUndefined();
    expect(readGitConflictHistory.input.parse(Object.fromEntries(url.searchParams))).toEqual({ workspaceRoot: input.workspaceRoot });
    return { ok: true, value: [] };
  });
  await expect(createReviewClient(transport).readGitConflictHistory({ workspaceRoot: input.workspaceRoot })).resolves.toEqual([]);
  expect(request).toHaveBeenCalledOnce();
});

it.each(['GET', 'DELETE'] as const)('preserves %s input in URL parameters, independently encoding path and query fields', async (method) => {
  const { request, transport } = setup();
  const operation = defineFeatureOperation({ id: 'test.history.read', path: '/v1/features/test/threads/:threadId/history', method, input: codec, output: codec, errors: {}, idempotency: 'safe' });
  await transport.call(operation, input);
  const sent = request.mock.calls[0][0];
  const url = new URL(sent.path, 'http://localhost');
  expect(decodeURIComponent(url.pathname)).toBe('/v1/features/test/threads/thread/一/history');
  expect(Object.fromEntries(url.searchParams)).toEqual({ workspaceRoot: input.workspaceRoot, limit: '0', archived: 'false' });
  expect(sent.body).toBeUndefined();
});

it('round-trips the live command identity for both confirmed design deletions', async () => {
  const { request, transport } = setup();
  const client = createDesignClient(transport, {} as DesignAssets);
  const command = { sessionId: 'session/1', id: 'command+2' };
  request.mockImplementation(async (sent) => {
    const url = new URL(sent.path, 'http://localhost');
    const operation = url.pathname === deleteDesignDocument.path ? deleteDesignDocument : removeDesignFont;
    const query = Object.fromEntries(url.searchParams);
    expect(designCommandFromQuery(operation.input.parse(query))).toEqual(command);
    delete query.commandId;
    expect(() => operation.input.parse(query)).toThrow();
    return { ok: true, value: null };
  });
  await client.delete({ path: '稿件.design.json', projectId: 'project', expectedRevision: 'rev', command });
  await client.fonts.remove('a'.repeat(64), undefined, command);
  expect(request).toHaveBeenCalledTimes(2);
});

it('keeps mutation input in the body and sends parameterless reads without a query', async () => {
  const { request, transport } = setup();
  const operation = defineFeatureOperation({ id: 'test.history.update', path: '/v1/features/test/threads/:threadId/history', method: 'POST', input: codec, output: codec, errors: {}, idempotency: 'idempotent' });
  await transport.call(operation, input);
  expect(request.mock.calls[0][0]).toMatchObject({ path: '/v1/features/test/threads/thread%2F%E4%B8%80/history', body: { workspaceRoot: input.workspaceRoot, limit: 0, archived: false } });
  expect(request.mock.calls[0][0].body).not.toHaveProperty('threadId');
  await transport.call({ ...operation, method: 'GET', path: '/v1/features/test/settings' }, undefined);
  expect(request.mock.calls[1][0]).toMatchObject({ path: '/v1/features/test/settings' });
  expect(request.mock.calls[1][0].body).toBeUndefined();
});

it('rejects unsupported query objects instead of silently dropping them', async () => {
  const { request, transport } = setup();
  const operation = defineFeatureOperation({ id: 'test.history.read', path: '/v1/features/test/history', method: 'GET', input: codec, output: codec, errors: {}, idempotency: 'safe' });
  await expect(transport.call(operation, { filter: { limit: 10 } })).rejects.toThrow('query parameter "filter"');
  expect(request).not.toHaveBeenCalled();
});
