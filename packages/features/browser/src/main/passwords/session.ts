import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { BrowserPasswordState, BrowserPasswordPrompt } from '../../contracts/passwords.js';
import { BROWSER_IPC_CHANNELS } from '../../contracts/bridge.js';
import { PasswordPageClient } from './page-client.js';
import { BrowserPasswordStore, parseCapturedLogin, passwordOrigin } from './store.js';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences } from '../../contracts/settings.js';

type PendingLogin = { prompt: BrowserPasswordPrompt; password: string; expiresAt: number };

export class BrowserPasswordSession {
  private page: PasswordPageClient | null = null;
  private disposed = false;
  private pending: PendingLogin | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private state: BrowserPasswordState;
  private readonly unsubscribe: () => void;

  constructor(private readonly tabId: string, private readonly contents: WebContents, private readonly store: BrowserPasswordStore,
    private readonly preferences: () => BrowserPreferences = () => DEFAULT_BROWSER_PREFERENCES) {
    this.state = { tabId, origin: null, available: false, logins: [], prompt: null };
    this.unsubscribe = store.subscribe(() => { void this.refresh(); });
    contents.on('dom-ready', this.start);
    contents.on('did-start-navigation', this.navigate);
    // Renderer registration commonly arrives just after dom-ready while Electron
    // still reports main-frame loading. Install now as well as on future documents.
    this.start();
  }

  async getState(): Promise<BrowserPasswordState> {
    await this.refresh();
    return this.state;
  }

  async save(id: string): Promise<boolean> {
    if (!this.preferences().savePasswords) return false;
    const pending = this.pending;
    if (this.disposed || !pending || pending.prompt.id !== id || pending.expiresAt < Date.now()) return false;
    await this.store.save(pending.prompt.origin, { username: pending.prompt.username, password: pending.password });
    this.dismiss(id);
    await this.refresh();
    return true;
  }

  dismiss(id: string): void {
    if (this.pending?.prompt.id !== id) return;
    clearTimeout(this.pendingTimer);
    this.pending = null;
    this.publish({ prompt: null });
  }

  refreshPreferences(): void {
    if (!this.preferences().savePasswords && this.pending) this.dismiss(this.pending.prompt.id);
  }

  async fill(id: string, formId?: string, signal?: AbortSignal): Promise<boolean> {
    const page = this.page;
    if (!page || !this.current(page) || signal?.aborted) return false;
    const login = (await this.store.list(page.origin)).find((item) => item.id === id);
    if (!login || !this.current(page) || signal?.aborted) return false;
    return await page.run({ kind: 'fill', username: login.username, password: login.password, formId }, signal) === true
      && this.current(page) && !signal?.aborted;
  }

  async delete(id: string): Promise<boolean> {
    const page = this.page;
    if (!page || !this.current(page)) return false;
    await this.store.delete(page.origin, id);
    await this.refresh();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.page?.dispose();
    this.page = null;
    this.pending = null;
    clearTimeout(this.pendingTimer);
    this.unsubscribe();
    this.contents.off('dom-ready', this.start);
    this.contents.off('did-start-navigation', this.navigate);
  }

  private readonly navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
    if (!mainFrame || inPlace) return;
    this.page?.dispose();
    this.page = null;
    // An already captured prompt stays bound to its original origin through login redirects.
    this.publish({ origin: null, available: false, logins: [] });
  };

  private readonly start = () => {
    if (this.disposed || this.contents.isDestroyed()) return;
    this.page?.dispose();
    const origin = passwordOrigin(this.contents.getURL());
    this.page = origin ? new PasswordPageClient(this.contents, randomUUID(), origin) : null;
    this.publish({ origin, available: false, logins: [] });
    if (this.page) void this.watch(this.page).catch(() => undefined);
    void this.refresh();
  };

  private current(page: PasswordPageClient): boolean {
    return !this.disposed && this.page === page && !this.contents.isDestroyed()
      && passwordOrigin(this.contents.getURL()) === page.origin;
  }

  private async refresh(): Promise<void> {
    const page = this.page;
    if (!page || !this.current(page)) return;
    try {
      const logins = await this.store.list(page.origin);
      if (this.current(page)) this.publish({ available: true, logins: logins.map(({ id, username }) => ({ id, username })) });
    } catch {
      if (this.current(page)) this.publish({ available: false, logins: [] });
    }
  }

  private async watch(page: PasswordPageClient): Promise<void> {
    await page.install();
    while (this.current(page)) {
      const value = await page.run({ kind: 'watch' });
      if (!value || !this.current(page) || typeof value !== 'object') break;
      const event = value as Record<string, unknown>;
      if (event.kind === 'form' && typeof event.formId === 'string') {
        // Do not hold up submission capture while the OS vault is unlocking.
        void this.autofill(page, event.formId).catch(() => undefined);
      } else if (event.kind === 'submit') {
        const login = parseCapturedLogin(event);
        if (login) void this.capture(page.origin, login).catch(() => undefined);
      }
    }
  }

  private async autofill(page: PasswordPageClient, formId: string): Promise<void> {
    if (!this.preferences().autofillPasswords) return;
    const logins = await this.store.list(page.origin);
    if (logins.length === 1 && this.current(page) && this.preferences().autofillPasswords) await this.fill(logins[0].id, formId);
  }

  private async capture(origin: string, login: { username: string; password: string }): Promise<void> {
    if (!this.preferences().savePasswords) return;
    clearTimeout(this.pendingTimer);
    const pending: PendingLogin = {
      prompt: { id: randomUUID(), origin, username: login.username, update: false },
      password: login.password,
      expiresAt: Date.now() + 5 * 60_000,
    };
    this.pending = pending;
    this.pendingTimer = setTimeout(() => this.dismiss(pending.prompt.id), 5 * 60_000);
    try {
      const existing = (await this.store.list(origin)).find((item) => item.username === login.username);
      if (this.disposed || this.pending !== pending) return;
      if (!this.preferences().savePasswords) { this.dismiss(pending.prompt.id); return; }
      if (existing?.password === login.password) { this.dismiss(pending.prompt.id); return; }
      pending.prompt = { ...pending.prompt, update: Boolean(existing) };
      this.publish({ prompt: pending.prompt });
    } catch { this.dismiss(pending.prompt.id); }
  }

  private publish(patch: Partial<BrowserPasswordState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    const host = this.contents.hostWebContents;
    if (host && !host.isDestroyed()) host.send(BROWSER_IPC_CHANNELS.passwordState, this.state);
  }
}
