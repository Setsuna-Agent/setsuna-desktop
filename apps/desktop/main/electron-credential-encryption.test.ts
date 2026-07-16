import { describe, expect, it, vi } from 'vitest';
import { electronCredentialEncryption } from './electron-credential-encryption.js';

describe('electronCredentialEncryption', () => {
  it('rejects the Linux basic_text backend', async () => {
    const provider = electronCredentialEncryption({
      decryptStringAsync: vi.fn(),
      encryptStringAsync: vi.fn(),
      getSelectedStorageBackend: () => 'basic_text',
      isAsyncEncryptionAvailable: async () => true,
    }, 'linux');

    await expect(provider.isAvailable()).resolves.toBe(false);
    expect(provider.backend()).toBe('basic_text');
  });
});
