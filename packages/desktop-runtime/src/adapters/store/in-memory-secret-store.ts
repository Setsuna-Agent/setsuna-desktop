import type { DesktopNativeBridge, SecretStore, SecretStoreStatus } from '../../ports/secret-store.js';

/** Explicit volatile store for tests and non-persistent ephemeral runtimes. */
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
