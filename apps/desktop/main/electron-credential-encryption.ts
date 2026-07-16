import type { CredentialEncryptionProvider } from './desktop-credential-vault.js';

type SafeStorageLike = Pick<Electron.SafeStorage,
  'decryptStringAsync' | 'encryptStringAsync' | 'getSelectedStorageBackend' | 'isAsyncEncryptionAvailable'>;

/** Adapts Electron safeStorage while refusing Linux's unprotected basic_text backend. */
export function electronCredentialEncryption(
  safeStorage: SafeStorageLike,
  platform: NodeJS.Platform = process.platform,
): CredentialEncryptionProvider {
  const backend = () => {
    if (platform === 'darwin') return 'macOS Keychain';
    if (platform === 'win32') return 'Windows Credential Protection';
    return safeStorage.getSelectedStorageBackend();
  };
  return {
    backend,
    isAvailable: async () => {
      if (platform === 'linux') {
        const selected = safeStorage.getSelectedStorageBackend();
        if (selected === 'basic_text' || selected === 'unknown') return false;
      }
      return safeStorage.isAsyncEncryptionAvailable();
    },
    encrypt: (plainText) => safeStorage.encryptStringAsync(plainText),
    decrypt: async (encrypted) => (await safeStorage.decryptStringAsync(encrypted)).result,
  };
}
