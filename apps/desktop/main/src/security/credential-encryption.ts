import type { CredentialEncryptionProvider } from './credential-vault.js';

type SafeStorageLike = Pick<Electron.SafeStorage,
  'decryptStringAsync' | 'encryptStringAsync' | 'getSelectedStorageBackend' | 'isAsyncEncryptionAvailable'>;

/** 适配 Electron safeStorage，同时拒绝 Linux 上未受保护的 basic_text 后端。 */
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
