import { describe, expect, it } from 'vitest';
import {
  normalizeWebDavLocation,
  normalizeWebDavUsername,
} from '../../src/main/normalization.js';

describe('WebDAV sync input normalization', () => {
  it('requires HTTPS except for loopback or explicit insecure opt-in', () => {
    expect(normalizeWebDavLocation({
      endpoint: 'https://dav.example.com/base/',
      remoteRoot: '/Setsuna/Backups/',
    })).toMatchObject({
      endpoint: 'https://dav.example.com/base',
      remoteRoot: '/Setsuna/Backups',
      remoteRootSegments: ['Setsuna', 'Backups'],
    });
    expect(() => normalizeWebDavLocation({
      endpoint: 'http://dav.example.com/base',
      remoteRoot: '/Setsuna',
    })).toThrow('默认必须使用 HTTPS');
    expect(normalizeWebDavLocation({
      endpoint: 'http://127.0.0.1:8080/dav',
      remoteRoot: '/Setsuna',
    }).endpoint).toBe('http://127.0.0.1:8080/dav');
    expect(normalizeWebDavLocation({
      endpoint: 'http://nas.lan/dav',
      remoteRoot: '/Setsuna',
      allowInsecureHttp: true,
    }).endpoint).toBe('http://nas.lan/dav');
  });

  it('rejects embedded credentials and unsafe path segments', () => {
    expect(() => normalizeWebDavLocation({
      endpoint: 'https://alice:secret@dav.example.com',
      remoteRoot: '/Setsuna',
    })).toThrow('不能包含账号');
    expect(() => normalizeWebDavLocation({
      endpoint: 'https://dav.example.com',
      remoteRoot: '/Setsuna/../Secrets',
    })).toThrow('路径片段');
    expect(() => normalizeWebDavUsername('alice:admin')).toThrow('用户名无效');
  });
});
