import { describe, expect, it, vi } from 'vitest';
import { electronCredentialEncryption } from '../../../src/security/credential-encryption.js';

describe('electronCredentialEncryption', () => {
  it('rejects unsupported hosts even when safeStorage advertises encryption', async () => {
    const isAsyncEncryptionAvailable = vi.fn(async () => true);
    const provider = electronCredentialEncryption({
      decryptStringAsync: vi.fn(),
      encryptStringAsync: vi.fn(),
      isAsyncEncryptionAvailable,
    }, 'freebsd');

    await expect(provider.isAvailable()).resolves.toBe(false);
    expect(isAsyncEncryptionAvailable).not.toHaveBeenCalled();
    expect(provider.backend()).toBe('Unsupported platform');
  });

  it.each(['darwin', 'win32'] as const)('honors safeStorage availability on %s', async (platform) => {
    const isAsyncEncryptionAvailable = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const encrypted = Buffer.from('encrypted');
    const encryptStringAsync = vi.fn(async () => encrypted);
    const decryptStringAsync = vi.fn(async () => ({ result: 'secret', shouldReEncrypt: false }));
    const provider = electronCredentialEncryption({
      isAsyncEncryptionAvailable, encryptStringAsync, decryptStringAsync,
    }, platform);

    await expect(provider.isAvailable()).resolves.toBe(false);
    await expect(provider.isAvailable()).resolves.toBe(true);
    await expect(provider.encrypt('secret')).resolves.toEqual(encrypted);
    await expect(provider.decrypt(encrypted)).resolves.toBe('secret');
    expect(encryptStringAsync).toHaveBeenCalledWith('secret');
    expect(decryptStringAsync).toHaveBeenCalledWith(encrypted);
  });
});
