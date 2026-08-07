import { describe, expect, it } from 'vitest';
import {
  defaultDesktopNetworkProxyRouting,
  normalizeDesktopNetworkProxyRoute,
  normalizeDesktopNetworkProxyUrl,
} from '../src/network-proxy/index.js';

describe('network proxy contracts', () => {
  it('accepts only credential-free HTTP, HTTPS, and SOCKS5 endpoints', () => {
    expect(normalizeDesktopNetworkProxyUrl(' socks5://127.0.0.1:1080/ ')).toBe('socks5://127.0.0.1:1080');
    expect(normalizeDesktopNetworkProxyUrl('https://proxy.example.com:8443')).toBe('https://proxy.example.com:8443');
    expect(normalizeDesktopNetworkProxyUrl('http://user:secret@proxy.example.com')).toBeNull();
    expect(normalizeDesktopNetworkProxyUrl('https://proxy.example.com/path')).toBeNull();
    expect(normalizeDesktopNetworkProxyUrl('ftp://proxy.example.com')).toBeNull();
  });

  it('normalizes route variants and rejects inherit for the global route', () => {
    expect(normalizeDesktopNetworkProxyRoute({ mode: 'proxy', proxyServerId: ' proxy-a ' }))
      .toEqual({ mode: 'proxy', proxyServerId: 'proxy-a' });
    expect(normalizeDesktopNetworkProxyRoute({ mode: 'inherit' }, { allowInherit: false })).toBeNull();
    expect(normalizeDesktopNetworkProxyRoute({ mode: 'proxy', proxyServerId: '' })).toBeNull();
    expect(defaultDesktopNetworkProxyRouting()).toEqual({
      global: { mode: 'system' },
      scopes: {
        browser: { mode: 'inherit' },
        runtime: { mode: 'inherit' },
        terminal: { mode: 'inherit' },
        updater: { mode: 'inherit' },
      },
    });
  });
});
