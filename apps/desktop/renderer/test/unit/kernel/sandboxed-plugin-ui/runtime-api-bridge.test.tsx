// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import type { SandboxedUiFrameProps } from '@setsuna-desktop/feature-ui-card/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SandboxedPluginUiView } from '../../../../src/kernel/declarative-plugin-ui/SandboxedPluginUiView.js';
import { SandboxedUiFrame } from '../../../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';
import { connectSandboxedUiFrame } from '../../../fixtures/sandboxed-ui-bridge.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('binds API requests to the installed app, replies to its frame, and cancels on unmount', async () => {
  const manifest = parseRuntimePluginUiManifest({
    schemaVersion: 2, actions: [], contributions: [{
      id: 'app.page', slot: 'renderer.plugin.page', navigation: { label: 'App' },
      document: { htmlResourceId: 'html', actionIds: [] },
    }],
  });
  const contribution = manifest.contributions[0];
  if (!contribution.document) throw new Error('Expected document');
  const requestRuntimeApi = vi.fn<PluginManagementRendererService['requestRuntimeApi']>()
    .mockResolvedValueOnce({ ok: true, status: 200, data: { projects: [{ id: 'existing' }] } })
    .mockImplementationOnce(() => new Promise(() => {}));
  const service = {
    requestRuntimeApi,
    readRendererUiDocument: vi.fn(async () => ({ revision: 'hash', html: '<main/>', css: '', js: '' })),
    subscribeRendererUiData: () => () => {},
  } as unknown as PluginManagementRendererService;
  let unmount: () => void = () => {};
  await act(async () => {
    ({ unmount } = render(<StrictMode><SandboxedPluginUiView
      contribution={contribution} manifest={manifest} pluginId="installed-app" revision="hash" service={service}
    /></StrictMode>));
  });
  const frame = screen.getByTitle('App') as HTMLIFrameElement;
  const { post, send } = connectSandboxedUiFrame(frame);
  const data = {
    channel: 'setsuna.sandboxed-ui.v1', type: 'runtime-request', requestId: 'read-1',
    pluginId: 'forged', contributionId: 'forged', request: { path: '/v1/projects' },
  };
  fireEvent(window, new MessageEvent('message', { source: window, data }));
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data }));
  expect(requestRuntimeApi).not.toHaveBeenCalled();
  send(data);
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: 'runtime-result', requestId: 'read-1', ok: true,
    result: { ok: true, status: 200, data: { projects: [{ id: 'existing' }] } },
  })));
  expect(requestRuntimeApi).toHaveBeenCalledWith({
    pluginId: 'installed-app', contributionId: 'app.page', request: { path: '/v1/projects', method: 'GET' },
  }, { signal: expect.any(AbortSignal) });
  expect(requestRuntimeApi.mock.calls[0][1]?.signal?.aborted).toBe(false);

  send({ ...data, requestId: 'read-2' });
  const signal = requestRuntimeApi.mock.calls[1][1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
});

it('keeps preview and conversation cards without an application bridge inert', async () => {
  render(<SandboxedUiFrame title="Preview" source={{ html: '', css: '', js: '' }} />);
  const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
  const { post, send } = connectSandboxedUiFrame(frame);
  send({ type: 'runtime-request', requestId: 'read', request: { path: '/v1/projects' } });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'runtime-result', ok: false })));
});

it.each(['pagehide', 'load'])('revokes a navigated document, cancels pending requests and isolates a replacement (%s)', async (departure) => {
  let resolve!: (value: { ok: true; status: number; data: { private: string } }) => void;
  const onRuntimeRequest = vi.fn<NonNullable<SandboxedUiFrameProps['onRuntimeRequest']>>(() => new Promise(done => { resolve = done; }));
  const onAction = vi.fn(async () => {});
  const source = { html: '<main/>', css: '', js: '' };
  const { rerender } = render(<SandboxedUiFrame source={source} title="App" data={{ private: 'snapshot' }}
    allowedActionIds={['save']} onAction={onAction} onRuntimeRequest={onRuntimeRequest} />);
  const frame = screen.getByTitle('App') as HTMLIFrameElement;
  const windowPost = vi.spyOn(frame.contentWindow!, 'postMessage');
  const original = connectSandboxedUiFrame(frame);
  expect(original.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot', data: { private: 'snapshot' } }));
  fireEvent.load(frame);
  original.send({ type: 'runtime-request', requestId: 'pending', request: { path: '/v1/projects' } });
  const signal = onRuntimeRequest.mock.calls[0][1];
  if (departure === 'pagehide') original.send({ type: 'unload' });
  else fireEvent.load(frame);
  expect(signal.aborted).toBe(true);
  expect(original.closed).toHaveBeenCalledOnce();
  original.post.mockClear();
  const successor = connectSandboxedUiFrame(frame);
  for (const data of [{ type: 'ready' }, { type: 'runtime-request', requestId: 'forged', request: { path: '/v1/projects' } },
    { type: 'invoke', requestId: 'forged', actionId: 'save', payload: {} }]) {
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'setsuna.sandboxed-ui.v1', ...data } }));
    successor.send(data);
  }
  rerender(<SandboxedUiFrame source={{ ...source }} title="App" data={{ private: 'updated' }}
    onRuntimeRequest={onRuntimeRequest} onAction={onAction} allowedActionIds={['save']} />);
  await act(async () => { resolve({ ok: true, status: 200, data: { private: 'late result' } }); });
  expect(onRuntimeRequest).toHaveBeenCalledOnce();
  expect(onAction).not.toHaveBeenCalled();
  expect(original.post).not.toHaveBeenCalled();
  expect(successor.post).not.toHaveBeenCalled();
  expect(windowPost).not.toHaveBeenCalled();

  rerender(<SandboxedUiFrame source={{ ...source, html: '<main>Replacement</main>' }} title="App" onRuntimeRequest={onRuntimeRequest} />);
  const replacement = connectSandboxedUiFrame(screen.getByTitle('App') as HTMLIFrameElement);
  replacement.send({ type: 'runtime-request', requestId: 'new', request: { path: '/v1/projects' } });
  expect(onRuntimeRequest).toHaveBeenCalledTimes(2);
  expect(onRuntimeRequest.mock.calls[1][1].aborted).toBe(false);
});
