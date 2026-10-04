import { randomBytes } from 'node:crypto';
import { parseSandboxDialogRequest, type SandboxDialogRequest, type SandboxDialogResult } from '@setsuna-desktop/contracts';
import type { BrowserWindow } from 'electron';

export type ShowSandboxDialog = (
  owner: BrowserWindow, request: SandboxDialogRequest, options: { title: string; signal: AbortSignal },
) => Promise<SandboxDialogResult>;

type Session = { owner: BrowserWindow; ownerId: number; title: string; controller: AbortController };

/** Each iframe gets only a revocable dialog capability, never the runtime/native bridge bearer token. */
export class SandboxDialogSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly busyOwners = new Set<number>();
  private readonly owners = new Map<number, () => void>();

  constructor(private readonly show: ShowSandboxDialog) {}

  register(owner: BrowserWindow, title: string): string {
    if (owner.isDestroyed()) throw new Error('Desktop window is unavailable.');
    if (typeof title !== 'string' || title.length > 512) throw new Error('Invalid dialog title.');
    if (this.sessions.size >= 256) throw new Error('Too many active sandbox dialog sessions.');
    const id = randomBytes(32).toString('hex');
    const ownerId = owner.webContents.id;
    this.sessions.set(id, { owner, ownerId, title, controller: new AbortController() });
    if (!this.owners.has(ownerId)) {
      const contents = owner.webContents;
      const dispose = () => {
        for (const [key, session] of this.sessions) if (session.ownerId === ownerId) this.release(ownerId, key);
      };
      owner.once('closed', dispose);
      contents.once('destroyed', dispose);
      contents.once('render-process-gone', dispose);
      this.owners.set(ownerId, () => {
        owner.removeListener('closed', dispose);
        contents.removeListener('destroyed', dispose);
        contents.removeListener('render-process-gone', dispose);
      });
    }
    return id;
  }

  release(ownerId: number, id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) return;
    this.sessions.delete(id);
    session.controller.abort();
    if (![...this.sessions.values()].some((entry) => entry.ownerId === ownerId)) {
      this.owners.get(ownerId)?.();
      this.owners.delete(ownerId);
    }
  }

  updateTitle(ownerId: number, id: string, title: string): void {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId || session.owner.isDestroyed()) {
      throw new Error('Sandbox dialog session is unavailable.');
    }
    if (typeof title !== 'string' || title.length > 512) throw new Error('Invalid dialog title.');
    session.title = title;
  }

  async request(id: string, value: unknown, signal: AbortSignal): Promise<SandboxDialogResult> {
    const session = this.sessions.get(id);
    if (!session || session.owner.isDestroyed()) throw new Error('Sandbox dialog session is unavailable.');
    const input = parseSandboxDialogRequest(value);
    const ownerId = session.ownerId;
    if (this.busyOwners.has(ownerId)) throw new Error('Another dialog is already open in this window.');
    const requestSignal = AbortSignal.any([session.controller.signal, signal]);
    requestSignal.throwIfAborted();
    this.busyOwners.add(ownerId);
    try {
      return await this.show(session.owner, input, { title: session.title, signal: requestSignal });
    } finally {
      this.busyOwners.delete(ownerId);
    }
  }

  dispose(): void {
    for (const [id, session] of this.sessions) this.release(session.ownerId, id);
  }
}
