// @vitest-environment happy-dom

import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxedPluginUiView } from '../../../../src/kernel/declarative-plugin-ui/SandboxedPluginUiView.js';

describe('SandboxedPluginUiView', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([false, true])('routes declared bridge actions (extra confirmation: %s)', async (confirmAction) => {
    const { contribution, manifest } = createWeatherUi(confirmAction);
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

    // Async resource reads mount the iframe; flush its effects before sending
    // the one-shot bridge message so the host listener is already registered.
    await act(async () => {
      render(
        <ConfirmationProvider><SandboxedPluginUiView
          contribution={contribution}
          manifest={manifest}
          pluginId="weather-plugin"
          revision="2026-08-31T00:00:00.000Z"
          service={service}
        /></ConfirmationProvider>,
      );
    });

    const frame = screen.getByTitle('Weather') as HTMLIFrameElement;
    expect(readRendererUiDocument).toHaveBeenCalledWith({
      pluginId: 'weather-plugin',
      contributionId: 'weather.page',
    }, { signal: expect.any(AbortSignal) });
    expect(frame.srcdoc).toContain('<main class="weather">Weather</main>');
    expect(frame.srcdoc).toContain('.weather { color: orange; }');

    const invoke = (requestId: string) => fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        channel: 'setsuna.sandboxed-ui.v1',
        type: 'invoke',
        requestId,
        actionId: 'weather.refresh',
        payload: { city: '杭州' },
      },
    }));

    invoke('action_1');
    if (confirmAction) {
      await screen.findByRole('dialog');
      vi.useFakeTimers();
      await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
      vi.useRealTimers();
      expect(runRendererUiAction).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(runRendererUiAction).not.toHaveBeenCalled();
      invoke('action_2');
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    } else {
      expect(screen.queryByRole('dialog')).toBeNull();
    }

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
    expect(runRendererUiAction).toHaveBeenCalledTimes(1);
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

function createWeatherUi(confirmAction = false) {
  const manifest = parseRuntimePluginUiManifest({
    schemaVersion: 2,
    actions: [{ id: 'weather.refresh', ...(confirmAction ? { approval: { message: 'Refresh weather?' } } : {}) }],
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
