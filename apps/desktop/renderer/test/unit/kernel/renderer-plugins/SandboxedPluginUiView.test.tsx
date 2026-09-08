// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxedPluginUiView } from '../../../../src/kernel/declarative-plugin-ui/SandboxedPluginUiView.js';

describe('SandboxedPluginUiView', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads declared resources and routes whitelisted bridge actions through approval', async () => {
    const { contribution, manifest } = createWeatherUi();
    const readRendererUiDocument = vi.fn(async () => ({
      revision: 'trusted-weather-hash',
      html: '<main class="weather">Weather</main>',
      css: '.weather { color: orange; }',
      js: 'window.setsunaUI.ready.then(() => {});',
    }));
    const runRendererUiAction = vi.fn(async (
      ..._args: Parameters<PluginManagementRendererService['runRendererUiAction']>
    ) => ({ status: 'completed' as const }));
    let dataListener: () => void = () => undefined;
    const service = {
      readRendererUiDocument,
      readRendererUiData: vi.fn(async () => ({ data: { temperature: 28 } })),
      runRendererUiAction: vi.fn(async (...args: Parameters<typeof runRendererUiAction>) => {
        const result = await runRendererUiAction(...args);
        dataListener();
        return result;
      }),
      subscribe: () => () => undefined,
      subscribeRendererUiData: (_pluginId: string, listener: () => void) => {
        dataListener = listener;
        return () => { dataListener = () => undefined; };
      },
    } as unknown as PluginManagementRendererService;
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <SandboxedPluginUiView
        contribution={contribution}
        manifest={manifest}
        pluginId="weather-plugin"
        revision="2026-08-31T00:00:00.000Z"
        service={service}
      />,
    );

    const frame = await screen.findByTitle('Weather') as HTMLIFrameElement;
    expect(readRendererUiDocument).toHaveBeenCalledWith({
      pluginId: 'weather-plugin',
      contributionId: 'weather.page',
    }, { signal: expect.any(AbortSignal) });
    expect(frame.srcdoc).toContain('<main class="weather">Weather</main>');
    expect(frame.srcdoc).toContain('.weather { color: orange; }');

    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        channel: 'setsuna.sandboxed-ui.v1',
        type: 'invoke',
        requestId: 'action_1',
        actionId: 'weather.refresh',
        payload: { city: '杭州' },
      },
    }));

    await waitFor(() => expect(runRendererUiAction).toHaveBeenCalledWith({
      pluginId: 'weather-plugin',
      actionId: 'weather.refresh',
      values: {},
      payload: { city: '杭州' },
      context: {
        contributionId: 'weather.page',
        surface: 'renderer.plugin.page',
      },
    }));
  });

  it('waits for the first data snapshot before mounting the sandboxed document', async () => {
    const { contribution, manifest } = createWeatherUi();
    const dataRequest = deferred<{ data: { temperature: number } }>();
    const service = {
      readRendererUiDocument: vi.fn(async () => ({
        revision: 'trusted-weather-hash',
        html: '<main>Weather</main>',
        css: '',
        js: 'window.setsunaUI.ready.then(({ data }) => render(data));',
      })),
      readRendererUiData: vi.fn(() => dataRequest.promise),
      subscribe: () => () => undefined,
      subscribeRendererUiData: () => () => undefined,
    } as unknown as PluginManagementRendererService;

    render(
      <SandboxedPluginUiView
        contribution={contribution}
        manifest={manifest}
        pluginId="weather-plugin"
        revision="2026-08-31T00:00:00.000Z"
        service={service}
      />,
    );

    await waitFor(() => expect(service.readRendererUiData).toHaveBeenCalledTimes(1));
    expect(screen.queryByTitle('Weather')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('正在加载插件数据…');

    await act(async () => {
      dataRequest.resolve({ data: { temperature: 28 } });
      await dataRequest.promise;
    });

    expect(await screen.findByTitle('Weather')).toBeTruthy();
  });

  it('shows an error instead of mounting a page with empty data when the first read fails', async () => {
    const { contribution, manifest } = createWeatherUi();
    const service = {
      readRendererUiDocument: vi.fn(async () => ({
        revision: 'trusted-weather-hash',
        html: '<main>Weather</main>',
        css: '',
        js: '',
      })),
      readRendererUiData: vi.fn(async () => { throw new Error('State unavailable'); }),
      subscribe: () => () => undefined,
      subscribeRendererUiData: () => () => undefined,
    } as unknown as PluginManagementRendererService;

    render(
      <SandboxedPluginUiView
        contribution={contribution}
        manifest={manifest}
        pluginId="weather-plugin"
        revision="2026-08-31T00:00:00.000Z"
        service={service}
      />,
    );

    expect((await screen.findByRole('alert')).textContent).toBe('插件数据暂时不可用。');
    expect(screen.queryByTitle('Weather')).toBeNull();
  });
});

function createWeatherUi() {
  const manifest = parseRuntimePluginUiManifest({
    schemaVersion: 2,
    actions: [{ id: 'weather.refresh', approval: { message: 'Refresh weather?' } }],
    contributions: [{
      id: 'weather.page',
      slot: 'renderer.plugin.page',
      navigation: { label: 'Weather' },
      data: { stateKey: 'weather.view', scope: 'global' },
      document: {
        htmlResourceId: 'weather-html',
        cssResourceId: 'weather-css',
        jsResourceId: 'weather-js',
        actionIds: ['weather.refresh'],
      },
    }],
  });
  const contribution = manifest.contributions[0];
  if (!contribution?.document) throw new Error('Expected a document contribution.');
  return { contribution, manifest };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
