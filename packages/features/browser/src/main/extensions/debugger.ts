import type { Extension, WebContents } from 'electron';
import type { ExtensionSystemEvent } from '../../contracts/extension-api.js';

type Attachment = { extensionId: string; contents: WebContents; sessions: Set<string>; dispose(): void };

/** Debugger targets are owned browser guests, never the desktop renderer or another extension. */
export class BrowserExtensionDebugger {
  private readonly attached = new Map<number, Attachment>();

  constructor(private readonly guests: () => readonly WebContents[],
    private readonly notify: (extensionId: string, event: ExtensionSystemEvent) => void) {}

  async call(extension: Extension, method: string, args: unknown[]): Promise<unknown> {
    if (!extension.manifest.permissions?.includes('debugger')) throw new Error('debugger permission required.');
    if (method === 'getTargets') return this.targets().map((contents) => ({ id: `webcontents:${contents.id}`, tabId: contents.id,
      type: 'page', title: contents.getTitle(), url: contents.getURL(), attached: contents.debugger.isAttached() }));
    const input = args[0];
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid debugging target.');
    const target = input as { tabId?: unknown; targetId?: unknown; sessionId?: unknown };
    const targetId = typeof target.targetId === 'string' && /^webcontents:[1-9]\d*$/.test(target.targetId)
      ? Number(target.targetId.slice(12)) : target.tabId;
    const contents = this.targets().find(({ id }) => id === targetId);
    if (!contents) throw new Error('Browser debugging target unavailable.');
    const source = { tabId: contents.id };

    if (method === 'attach') {
      if (target.sessionId !== undefined || typeof args[1] !== 'string') throw new Error('Invalid debugging protocol version.');
      if (contents.debugger.isAttached()) throw new Error('Another debugger is already attached to the tab.');
      contents.debugger.attach(args[1]);
      const attachment: Attachment = { extensionId: extension.id, contents, sessions: new Set(), dispose: () => {
        contents.debugger.off('message', message).off('detach', detached);
        contents.off('did-navigate', navigated);
        this.attached.delete(contents.id);
      } };
      const message = (_event: Electron.Event, method: string, params: Record<string, unknown>, sessionId: string) => {
        if (method === 'Target.attachedToTarget' && typeof params.sessionId === 'string') attachment.sessions.add(params.sessionId);
        if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') attachment.sessions.delete(params.sessionId);
        this.notify(extension.id, { kind: 'debuggerEvent', source: { ...source, ...(sessionId ? { sessionId } : {}) }, method, params });
      };
      const detached = (_event: Electron.Event, reason: string) => {
        attachment.dispose();
        this.notify(extension.id, { kind: 'debuggerDetach', source, reason: reason === 'target_closed' ? 'target_closed' : 'canceled_by_user' });
      };
      const navigated = () => {
        if (!this.targets().includes(contents) && contents.debugger.isAttached()) contents.debugger.detach();
      };
      this.attached.set(contents.id, attachment);
      contents.debugger.on('message', message).on('detach', detached);
      contents.on('did-navigate', navigated);
      return;
    }

    const attachment = this.attached.get(contents.id);
    if (attachment?.extensionId !== extension.id) throw new Error('Debugger is not attached by this extension.');
    if (method === 'detach') { contents.debugger.detach(); return; }
    if (method !== 'sendCommand' || typeof args[1] !== 'string') throw new Error('Invalid debugger method.');
    const sessionId = target.sessionId;
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !attachment.sessions.has(sessionId))) throw new Error('Debugging session unavailable.');
    const command = args[1];
    // Browser/Target-wide commands can escape a webview's session and reach app-owned targets.
    if (command.startsWith('Browser.') || command.startsWith('Target.')) throw new Error('Browser-wide debugging commands are unavailable.');
    if (args[2] !== undefined && (!args[2] || typeof args[2] !== 'object' || Array.isArray(args[2]))) throw new Error('Invalid command parameters.');
    if (command === 'Page.navigate') {
      const url = (args[2] as { url?: unknown } | undefined)?.url;
      if (typeof url !== 'string' || !/^(https?:|about:blank$)/.test(url)) throw new Error('Debugging navigation requires a web URL.');
    }
    return contents.debugger.sendCommand(command, args[2], sessionId as string | undefined);
  }

  remove(extensionId: string): void {
    for (const attachment of [...this.attached.values()]) {
      if (attachment.extensionId !== extensionId) continue;
      if (!attachment.contents.isDestroyed() && attachment.contents.debugger.isAttached()) attachment.contents.debugger.detach();
      attachment.dispose();
    }
  }

  dispose(): void { for (const { extensionId } of [...this.attached.values()]) this.remove(extensionId); }

  private targets(): WebContents[] {
    return this.guests().filter((contents) => !contents.isDestroyed() && /^(https?:|about:blank$)/.test(contents.getURL()));
  }
}
