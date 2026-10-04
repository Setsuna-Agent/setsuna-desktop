import type { WebContents } from 'electron';
import { findPasswordForms } from './forms.js';
import { installPasswordPage, type PasswordPageAction } from './page.js';

const passwordWorld = 1_005;

export class PasswordPageClient {
  private readonly abort = new AbortController();

  constructor(private readonly contents: WebContents, readonly token: string, readonly origin: string) {}

  install(): Promise<unknown> {
    return this.execute(`(${installPasswordPage.toString()})(${JSON.stringify(this.token)}, ${JSON.stringify(this.origin)}, ${findPasswordForms.toString()})`);
  }

  run(action: PasswordPageAction, signal?: AbortSignal): Promise<unknown> {
    return this.execute(this.code(action), action.kind === 'watch', signal);
  }

  dispose(): void {
    this.abort.abort();
    if (!this.contents.isDestroyed()) {
      void this.contents.executeJavaScriptInIsolatedWorld(passwordWorld, [{ code: this.code({ kind: 'dispose' }) }]).catch(() => undefined);
    }
  }

  private code(action: PasswordPageAction): string {
    // A late command cannot affect another document, even after a same-origin reload.
    return `window.__setsunaPasswords?.token === ${JSON.stringify(this.token)} && location.origin === ${JSON.stringify(this.origin)} ? window.__setsunaPasswords.run(${JSON.stringify(action)}) : null`;
  }

  private async execute(code: string, wait = false, operationSignal?: AbortSignal): Promise<unknown> {
    const signal = operationSignal ? AbortSignal.any([this.abort.signal, operationSignal]) : this.abort.signal;
    if (signal.aborted || this.contents.isDestroyed()) return null;
    let cancel!: () => void;
    const cancelled = new Promise<null>((resolve) => { cancel = () => resolve(null); });
    signal.addEventListener('abort', cancel, { once: true });
    const timer = wait ? undefined : setTimeout(cancel, 3000);
    try {
      return await Promise.race([cancelled, this.contents.executeJavaScriptInIsolatedWorld(passwordWorld, [{ code }])]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }
}
