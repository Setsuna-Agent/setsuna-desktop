import type { CredentialEncryptionProvider } from './credential-vault.js';

type SafeStorageLike = Pick<Electron.SafeStorage,
  'decryptStringAsync' | 'encryptStringAsync' | 'isAsyncEncryptionAvailable'>;

/** Only supported desktop hosts may enable credential encryption. */
export function electronCredentialEncryption(
  safeStorage: SafeStorageLike,
  platform: NodeJS.Platform = process.platform,
): CredentialEncryptionProvider {
  const backend = () => {
    if (platform === 'darwin') return 'macOS Keychain';
    if (platform === 'win32') return 'Windows Credential Protection';
    return 'Unsupported platform';
  };
  return {
    backend,
    isAvailable: async () => {
      if (platform !== 'darwin' && platform !== 'win32') return false;
      return safeStorage.isAsyncEncryptionAvailable();
    },
    encrypt: (plainText) => safeStorage.encryptStringAsync(plainText),
    decrypt: async (encrypted) => (await safeStorage.decryptStringAsync(encrypted)).result,
  };
}
