// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SandboxedPluginUiView } from '../../../../src/kernel/declarative-plugin-ui/SandboxedPluginUiView.js';
import { SandboxedUiFrame } from '../../../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';

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
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const data = {
    channel: 'setsuna.sandboxed-ui.v1', type: 'runtime-request', requestId: 'read-1',
    pluginId: 'forged', contributionId: 'forged', request: { path: '/v1/projects' },
  };
  fireEvent(window, new MessageEvent('message', { source: window, data }));
  expect(requestRuntimeApi).not.toHaveBeenCalled();
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: 'runtime-result', requestId: 'read-1', ok: true,
    result: { ok: true, status: 200, data: { projects: [{ id: 'existing' }] } },
  }), '*'));
  expect(requestRuntimeApi).toHaveBeenCalledWith({
    pluginId: 'installed-app', contributionId: 'app.page', request: { path: '/v1/projects', method: 'GET' },
  }, { signal: expect.any(AbortSignal) });
  expect(requestRuntimeApi.mock.calls[0][1]?.signal?.aborted).toBe(false);

  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { ...data, requestId: 'read-2' } }));
  const signal = requestRuntimeApi.mock.calls[1][1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
});

it('keeps preview and conversation cards without an application bridge inert', async () => {
  render(<SandboxedUiFrame title="Preview" source={{ html: '', css: '', js: '' }} />);
  const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent(window, new MessageEvent('message', {
    source: frame.contentWindow,
    data: { channel: 'setsuna.sandboxed-ui.v1', type: 'runtime-request', requestId: 'read', request: { path: '/v1/projects' } },
  }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'runtime-result', ok: false }), '*'));
});
