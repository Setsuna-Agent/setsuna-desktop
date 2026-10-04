import { expect, it, vi } from 'vitest';
import { RuntimeApiToolHost } from '../../../src/adapters/tool/runtime-api-tool-host.js';
import { installedAppBuilder } from '../../support/app-builder.js';

it('lets the authoring agent inspect projects without a bound project while keeping its tool read-only', async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, data: { projects: [{ id: 'existing' }] } }));
  const host = new RuntimeApiToolHost({ request }, { listPlugins: async () => ({ plugins: [installedAppBuilder()] }) });
  const signal = new AbortController().signal;
  const context = { threadId: 'projectless-chat', readOnly: true, signal };
  expect(await host.listTools(context)).toEqual([expect.objectContaining({ name: 'read_runtime_api' })]);
  const result = await host.runTool('read_runtime_api', { path: '/v1/projects' }, context);
  expect(result.data).toMatchObject({ data: { projects: [{ id: 'existing' }] } });
  expect(request).toHaveBeenCalledWith({ path: '/v1/projects', method: 'GET' }, signal);
  await expect(host.runTool('read_runtime_api', { path: '/v1/projects', method: 'DELETE' }, context)).rejects.toThrow(/only accepts GET/u);
  expect(request).toHaveBeenCalledTimes(1);
});

it('attributes backend reads to the installed builder and revokes them after removal or disablement', async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, data: {} }));
  const builder = installedAppBuilder();
  const listPlugins = vi.fn(async () => ({ plugins: [builder] }));
  const host = new RuntimeApiToolHost({ request }, { listPlugins });
  const context = { threadId: 'chat' };
  expect(await host.toolRuntimeProfile('read_runtime_api', context)).toMatchObject({
    plugin: { id: 'app-builder', name: builder.name, icon: builder.icon }, supportsParallel: true,
  });
  for (const source of ['local', 'repository'] as const) {
    listPlugins.mockResolvedValueOnce({ plugins: [{ ...builder, installationSource: source }] });
    expect(await host.listTools(context)).toEqual([]);
  }
  expect(await host.listTools({ ...context, features: { plugins: false } })).toEqual([]);
  listPlugins.mockResolvedValue({ plugins: [] });
  expect(await host.listTools(context)).toEqual([]);
  await expect(host.runTool('read_runtime_api', { path: '/v1/projects' }, context)).rejects.toThrow('App Builder tool unavailable');
  expect(request).not.toHaveBeenCalled();
});

it('rejects host file routes before forwarding, including normalized paths and attachment previews', async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, data: {} }));
  const host = new RuntimeApiToolHost({ request }, { listPlugins: async () => ({ plugins: [installedAppBuilder()] }) });
  for (const path of [
    '/v1/projects/project/read?path=private%2Fsecret.txt',
    '/v1/projects/project/files?path=private',
    '/v1/projects/project/entries/search?q=secret',
    '/v1/projects/project/search?q=secret',
    '/v1/threads/../projects/project/read?path=secret.txt',
    '/v1/projects/project/%2e%2e/project/read?path=secret.txt',
    '/v1/workspace/status?projectId=project',
    '/v1/threads/thread/attachments/image/image',
    '/v1/attachments/image',
  ]) {
    await expect(host.runTool('read_runtime_api', { path }, {
      threadId: 'chat', permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: { deniedRoots: ['/private'] },
    })).rejects.toThrow('Use file tools');
  }
  expect(request).not.toHaveBeenCalled();
});

it.each([
  '/v1/threads?scope=all', '/v1/threads/history', '/v1/threads/history/messages',
  '/v1/threads/history/event-history', '/v1/threads/history/tool-results/result',
  '/v1/features/conversation-debug/threads/history/traces/0',
])('marks externally sourced runtime records for memory policy: %s', async (path) => {
  const host = new RuntimeApiToolHost({
    request: async () => ({ ok: true, status: 200, data: { content: 'Stored external content' } }),
  }, { listPlugins: async () => ({ plugins: [installedAppBuilder()] }) });
  expect(await host.runTool('read_runtime_api', { path }, { threadId: 'chat' }))
    .toMatchObject({ containsExternalContext: true, data: { data: { content: 'Stored external content' } } });
});
