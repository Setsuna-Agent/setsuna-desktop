import type { DesktopNetworkProxyState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopNetworkProxyStateView } from '../../../../src/app/controller/useDesktopNetworkProxy.js';
import { NetworkProxySettings } from '../../../../src/features/settings/network-proxy/NetworkProxySettings.js';
import { ProxyServerDialog } from '../../../../src/features/settings/network-proxy/ProxyServerDialog.js';

describe('NetworkProxySettings', () => {
  it('renders configured proxy servers as summary cards', () => {
    const html = renderToStaticMarkup(<NetworkProxySettings proxy={proxyView(proxyState)} />);

    expect(html).toContain('settings-network-proxy__server-grid');
    expect(html).toContain('settings-network-proxy__server-card');
    expect(html).toContain('本机代理');
    expect(html).toContain('socks5://127.0.0.1:7897');
    expect(html).toContain('SOCKS5');
    expect(html).toContain('已配置认证');
    expect(html).toContain('使用中');
    expect(html).not.toContain('settings-network-proxy-dialog');
  });

  it('renders editing fields inside the shared proxy dialog', () => {
    const html = renderToStaticMarkup(
      <ProxyServerDialog
        busy={false}
        server={proxyState.servers[0]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('编辑代理服务器');
    expect(html).toContain('value="本机代理"');
    expect(html).toContain('value="socks5://127.0.0.1:7897"');
    expect(html).toContain('placeholder="支持 http://、https://、socks5://"');
    expect(html).toContain('placeholder="可选"');
    expect(html).toContain('留空则保留当前密码');
    expect(html).toContain('保存时清除用户名和密码');
    expect(html).not.toContain('<small>支持 http://、https://、socks5://</small>');
    expect(html).not.toContain('<small>可选</small>');
  });
});

function proxyView(state: DesktopNetworkProxyState): DesktopNetworkProxyStateView {
  return {
    busy: false,
    deleteServer: vi.fn(),
    error: null,
    loading: false,
    setRouting: vi.fn(),
    state,
    upsertServer: vi.fn(),
  };
}

const proxyState: DesktopNetworkProxyState = {
  configPath: '/tmp/network-proxy.json',
  servers: [{
    id: 'proxy-local',
    name: '本机代理',
    passwordSet: true,
    url: 'socks5://127.0.0.1:7897',
    username: 'setsuna',
  }],
  routing: {
    global: { mode: 'proxy', proxyServerId: 'proxy-local' },
    scopes: {
      browser: { mode: 'inherit' },
      runtime: { mode: 'inherit' },
      terminal: { mode: 'inherit' },
      updater: { mode: 'inherit' },
    },
  },
};
