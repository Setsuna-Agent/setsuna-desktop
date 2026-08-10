import { describe, expect, it } from 'vitest';
import {
  defaultDesktopNetworkProxyRouting,
  isDesktopNetworkProxyLoopbackUrl,
  normalizeDesktopNetworkProxyRoute,
  normalizeDesktopNetworkProxyUrl,
} from '../src/network-proxy/index.js';

describe('network proxy contracts', () => {
  it('accepts only credential-free HTTP, HTTPS, and SOCKS5 endpoints', () => {
    expect(normalizeDesktopNetworkProxyUrl(' socks5://127.0.0.1:1080/ ')).toBe('socks5://127.0.0.1:1080');
    expect(normalizeDesktopNetworkProxyUrl('https://proxy.example.com:8443')).toBe('https://proxy.example.com:8443');
    expect(normalizeDesktopNetworkProxyUrl('http://user:secret@proxy.example.com')).toBeNull();
    expect(normalizeDesktopNetworkProxyUrl('https://proxy.example.com/path')).toBeNull();
    expect(normalizeDesktopNetworkProxyUrl('http://proxy.example.com:0')).toBeNull();
    expect(normalizeDesktopNetworkProxyUrl('ftp://proxy.example.com')).toBeNull();
  });

  it('normalizes route variants and rejects inherit for the global route', () => {
    expect(normalizeDesktopNetworkProxyRoute({ mode: 'proxy', proxyServerId: ' Proxy-A ' }))
      .toEqual({ mode: 'proxy', proxyServerId: 'proxy-a' });
    expect(normalizeDesktopNetworkProxyRoute({ mode: 'inherit' }, { allowInherit: false })).toBeNull();
    expect(normalizeDesktopNetworkProxyRoute({ mode: 'proxy', proxyServerId: '' })).toBeNull();
    expect(defaultDesktopNetworkProxyRouting()).toEqual({
      global: { mode: 'system' },
      scopes: {
        browser: { mode: 'inherit' },
        runtime: { mode: 'inherit' },
        sync: { mode: 'inherit' },
        terminal: { mode: 'inherit' },
        updater: { mode: 'inherit' },
      },
    });
  });

  it('recognizes local provider URLs without treating lookalike hosts as loopback', () => {
    expect(isDesktopNetworkProxyLoopbackUrl('http://localhost:11434/v1')).toBe(true);
    expect(isDesktopNetworkProxyLoopbackUrl('http://models.localhost:11434/v1')).toBe(true);
    expect(isDesktopNetworkProxyLoopbackUrl('http://127.42.0.8:11434/v1')).toBe(true);
    expect(isDesktopNetworkProxyLoopbackUrl('http://[::1]:11434/v1')).toBe(true);
    expect(isDesktopNetworkProxyLoopbackUrl('http://[::ffff:127.42.0.8]:11434/v1')).toBe(true);
    expect(isDesktopNetworkProxyLoopbackUrl('http://[::ffff:192.168.1.1]:11434/v1')).toBe(false);
    expect(isDesktopNetworkProxyLoopbackUrl('https://localhost.example.com/v1')).toBe(false);
    expect(isDesktopNetworkProxyLoopbackUrl('https://127.0.0.1.example.com/v1')).toBe(false);
  });
});
