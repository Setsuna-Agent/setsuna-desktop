import type { DesktopNetworkProxyServerState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProxyServerDialog } from '../../../../src/features/settings/network-proxy/ProxyServerDialog.js';

describe('network proxy settings', () => {
  it('preserves authenticated proxy identity while exposing credential controls', () => {
    const server: DesktopNetworkProxyServerState = {
      id: 'proxy-local',
      name: 'Local proxy',
      passwordSet: true,
      url: 'socks5://127.0.0.1:7897',
      username: 'setsuna',
    };

    const html = renderToStaticMarkup(
      <ProxyServerDialog
        busy={false}
        server={server}
        onClose={() => undefined}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain('value="Local proxy"');
    expect(html).toContain('value="socks5://127.0.0.1:7897"');
    expect(html).toContain('value="setsuna"');
    expect(html).toContain('留空则保留当前密码');
    expect(html).toContain('保存时清除用户名和密码');
  });
});
