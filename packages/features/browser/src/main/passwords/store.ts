import { randomUUID } from 'node:crypto';

/** The host scopes this port to one OS-encrypted vault entry. */
export interface BrowserPasswordStorage {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}

export type StoredBrowserLogin = { id: string; origin: string; username: string; password: string };

export function passwordOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    // Never downgrade HTTPS credentials or fill arbitrary insecure remote sites.
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && local))
      ? url.origin : null;
  } catch { return null; }
}

export function parseCapturedLogin(value: unknown): { username: string; password: string } | null {
  if (!value || typeof value !== 'object') return null;
  const { username, password } = value as Record<string, unknown>;
  return typeof username === 'string' && username.length <= 512
    && typeof password === 'string' && password.length > 0 && password.length <= 4096
    ? { username, password } : null;
}

export class BrowserPasswordStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: BrowserPasswordStorage) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async list(origin: string): Promise<StoredBrowserLogin[]> {
    await this.queue;
    return (await this.read()).filter((login) => login.origin === origin);
  }

  async listMetadata(): Promise<Omit<StoredBrowserLogin, 'password'>[]> {
    await this.queue;
    return (await this.read()).map(({ id, origin, username }) => ({ id, origin, username }));
  }

  clear(): Promise<void> { return this.update((logins) => { logins.length = 0; }); }

  save(origin: string, value: { username: string; password: string }): Promise<void> {
    if (passwordOrigin(origin) !== origin || !parseCapturedLogin(value)) return Promise.reject(new Error('Invalid browser login.'));
    return this.update((logins) => {
      const previous = logins.find((login) => login.origin === origin && login.username === value.username);
      if (previous) previous.password = value.password;
      else logins.push({ id: randomUUID(), origin, ...value });
    });
  }

  delete(origin: string, id: string): Promise<void> {
    return this.update((logins) => {
      const index = logins.findIndex((login) => login.origin === origin && login.id === id);
      if (index >= 0) logins.splice(index, 1);
    });
  }

  private update(change: (logins: StoredBrowserLogin[]) => void): Promise<void> {
    const pending = this.queue.then(async () => {
      const logins = await this.read();
      change(logins);
      await this.storage.write(JSON.stringify({ version: 1, logins }));
      for (const listener of this.listeners) listener();
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async read(): Promise<StoredBrowserLogin[]> {
    const raw = await this.storage.read();
    if (raw === undefined) return [];
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.logins) || data.logins.some((login: StoredBrowserLogin) => (
      !login || typeof login.id !== 'string' || typeof login.origin !== 'string'
      || passwordOrigin(login.origin) !== login.origin || !parseCapturedLogin(login)
    ))) throw new Error('Invalid browser password store.');
    return data.logins;
  }
}
