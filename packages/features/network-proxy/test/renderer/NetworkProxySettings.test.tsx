import type { DesktopNetworkProxyServerState, DesktopNetworkProxyState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkProxyRendererView } from '../../src/renderer/context.js';
import { NetworkProxySettings } from '../../src/renderer/NetworkProxySettings.js';
import { ProxyServerDialog } from '../../src/renderer/ProxyServerDialog.js';
import { testSettingsViewUi, translateNetworkProxyForTest } from '../support/renderer-view.js';

describe('network proxy settings', () => {
  it('shows the active configured proxy and preserves its credential controls', () => {
    const server: DesktopNetworkProxyServerState = {
      id: 'proxy-local',
      name: 'Local proxy',
      passwordSet: true,
      url: 'socks5://127.0.0.1:7897',
      username: 'setsuna',
    };
    const state: DesktopNetworkProxyState = {
      configPath: '/tmp/network-proxy.json',
      servers: [server],
      routing: {
        global: { mode: 'proxy', proxyServerId: server.id },
        scopes: {
          browser: { mode: 'inherit' },
          runtime: { mode: 'inherit' },
          sync: { mode: 'inherit' },
          terminal: { mode: 'inherit' },
          updater: { mode: 'inherit' },
        },
      },
    };
    const proxy: NetworkProxyRendererView = {
      available: true,
      busy: false,
      deleteServer: vi.fn(),
      error: null,
      loading: false,
      setRouting: vi.fn(),
      state,
      upsertServer: vi.fn(),
    };

    const summaryHtml = renderToStaticMarkup(
      <NetworkProxySettings
        proxy={proxy}
        translate={translateNetworkProxyForTest}
        ui={testSettingsViewUi}
      />,
    );
    const html = renderToStaticMarkup(
      <ProxyServerDialog
        busy={false}
        server={server}
        translate={translateNetworkProxyForTest}
        ui={testSettingsViewUi}
        onClose={() => undefined}
        onSave={async () => undefined}
      />,
    );

    expect(summaryHtml).toContain('Local proxy');
    expect(summaryHtml).toContain('socks5://127.0.0.1:7897');
    expect(summaryHtml).toContain('已配置认证');
    expect(summaryHtml).toContain('使用中');
    expect(html).toContain('value="Local proxy"');
    expect(html).toContain('value="socks5://127.0.0.1:7897"');
    expect(html).toContain('value="setsuna"');
    expect(html).toContain('留空则保留当前密码');
    expect(html).toContain('保存时清除用户名和密码');
  });
});
