import type { DesktopNativeBridge, SecretStore, SecretStoreStatus } from '../../ports/secret-store.js';

/** 供测试和非持久化临时 runtime 使用的显式易失存储。 */
export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async status(): Promise<SecretStoreStatus> {
    return { available: true, backend: 'memory' };
  }

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class InMemoryDesktopNativeBridge extends InMemorySecretStore implements DesktopNativeBridge {
  readonly openedUrls: string[] = [];

  async openExternal(url: string): Promise<void> {
    this.openedUrls.push(url);
  }
}
