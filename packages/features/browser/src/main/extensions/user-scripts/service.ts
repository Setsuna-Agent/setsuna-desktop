import { randomUUID } from 'node:crypto';
import { ipcMain, MessageChannelMain, webContents, webFrameMain, type Extension, type IpcMainEvent, type IpcMainInvokeEvent, type MessagePortMain, type Session, type WebContents, type WebFrameMain } from 'electron';
import { USER_SCRIPTS_CHANNELS as channels, NO_RECEIVER_ERROR, type ContentScriptExecution, type PortWire, type WireAnswer, type WireExtensionPlan, type WorldMessageResult } from '../../../contracts/user-scripts.js';
import type { UserScriptsState } from '../../../contracts/user-script-types.js';
import { applyUpdates, DEFAULT_USER_SCRIPT_CSP, normalizeInjection, normalizeRegistrations, normalizeWorldConfig, planUserScripts,
  resetWorldConfig, selectScripts, setWorldConfig, userScriptsMethodUnavailable, worldConfigFor } from './model.js';
import { matchesHost } from './match-pattern.js';
import { firstDeliveryResponse, record, UserScriptMessaging } from './messaging.js';
import { scriptSources, UserScriptStore } from './store.js';
import { ExtensionContexts } from '../contexts.js';
import { extensionFrameId as frameId } from '../frame-id.js';
import type { UserScriptsExtensionEvent } from '../../../contracts/user-scripts.js';

type Document = { contents: WebContents; frame: WebFrameMain; id: string; key: string; worlds: Map<string, Set<string | null>>; lifetime: MessagePortMain };
type Pending = { document: Document; extensionId: string; resolve(answer: WireAnswer | null): void; timer: ReturnType<typeof setTimeout> };
type Options = { session: Session; directory: string; resolve(url: string): Extension | null; allowed(id: string): boolean; ownsGuest(contents: WebContents): boolean };

/** Host for Chrome's missing userScripts API, scoped to the embedded browser session. */
export class BrowserUserScripts {
  private readonly states = new Map<string, UserScriptsState>();
  private readonly documents = new Map<string, Document>();
  private readonly pending = new Map<number, Pending>();
  private readonly messaging = new UserScriptMessaging();
  private readonly contexts: ExtensionContexts<UserScriptsExtensionEvent>;
  private readonly store: UserScriptStore;
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly options: Options) {
    this.store = new UserScriptStore(options.directory);
    this.contexts = new ExtensionContexts({ ...options, channels,
      bootstrap: (extension) => extension.manifest.permissions?.includes('userScripts')
        ? { extensionId: extension.id, allowed: options.allowed(extension.id) } : null,
      call: (extension, key, method, args) => this.call(extension, key, method, args),
      closed: (key) => this.messaging.forgetEndpoint(key) });
  }

  start(): void {
    this.contexts.start();
    ipcMain.on(channels.plan, this.plan);
    ipcMain.handle(channels.message, this.message);
    ipcMain.on(channels.port, this.port); ipcMain.on(channels.answer, this.answer);
  }

  load(extension: Extension): void {
    if (extension.manifest.permissions?.includes('userScripts')) this.states.set(extension.id, this.store.read(extension.id));
  }

  unload(id: string): void {
    this.invalidate(id);
    this.states.delete(id); this.contexts.remove(id); this.messaging.forgetExtension(id);
    for (const document of this.documents.values()) document.worlds.delete(id);
    for (const [token, pending] of this.pending) if (pending.extensionId === id) this.finish(token, null);
  }

  async remove(id: string): Promise<void> { this.unload(id); await this.idle(); await this.store.remove(id); }
  async idle(): Promise<void> { await this.queue.catch(() => undefined); }

  /** The scripting adapter checks activeTab; this shared transport owns document/response lifetimes. */
  async executeScript(extensionId: string, contents: WebContents, frame: WebFrameMain, world: ContentScriptExecution['world'], code: string[], injectImmediately: boolean): Promise<unknown> {
    const document = this.documents.get(`${contents.id}:${frame.processId}:${frame.routingId}`);
    if (!document || !this.live(document) || !this.options.ownsGuest(contents)) throw new Error('Document unavailable.');
    const targetFrameId = frameId(frame);
    const answer = await this.request(document, extensionId, channels.scripting, { extensionId, documentId: document.id, world, code, injectImmediately });
    if (!answer || answer.error) throw new Error(answer?.error ?? 'Document closed.');
    return { frameId: targetFrameId, documentId: document.id, result: answer.result };
  }

  setAllowed(id: string, allowed: boolean): void {
    this.contexts.notify(id, { kind: 'allowed', allowed });
    if (!allowed) {
      this.invalidate(id);
      this.messaging.forgetExtension(id);
      for (const document of this.documents.values()) document.worlds.delete(id);
      for (const [token, pending] of this.pending) if (pending.extensionId === id) this.finish(token, null);
    }
  }

  private invalidate(extensionId: string): void {
    // Plans already live in page preloads. Clear their queues even when the extension
    // has no messaging world (MAIN scripts), without discarding unrelated extensions.
    for (const { frame } of this.documents.values()) {
      try { if (!frame.isDestroyed()) frame.send(channels.invalidate, { extensionId }); }
      catch { /* document closed */ }
    }
  }

  track(contents: WebContents): () => void {
    const replacing = new Map<number, readonly Document[]>();
    const navigating = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isSameDocument) return;
      const id = event.isMainFrame ? 0 : event.frame && frameId(event.frame);
      if (id == null) return;
      // A download or cancelled navigation keeps the current document. Remember what
      // would be replaced, but leave its messages and ports alive until a real commit.
      replacing.set(id, [...this.documents.values()].filter((document) => document.contents === contents
        && (event.isMainFrame || !document.frame.isDestroyed() && frameId(document.frame) === id)));
    };
    const committed = (_event: Electron.Event, _url: string, _code: number, _status: string,
      isMainFrame: boolean, processId: number, routingId: number) => {
      const frame = webFrameMain.fromId(processId, routingId);
      const id = isMainFrame ? 0 : frame && frameId(frame);
      if (id == null) return;
      for (const document of replacing.get(id) ?? []) {
        // The new document's preload can register before this event reaches main.
        if (this.documents.get(document.key) === document) this.forget(document);
      }
      if (isMainFrame) replacing.clear();
      else replacing.delete(id);
    };
    const clear = () => {
      replacing.clear();
      for (const document of this.documents.values()) if (document.contents === contents) this.forget(document);
    };
    const dispose = () => {
      contents.off('did-start-navigation', navigating).off('did-frame-navigate', committed)
        .off('render-process-gone', clear).off('destroyed', dispose);
      clear();
    };
    contents.on('did-start-navigation', navigating).on('did-frame-navigate', committed)
      .on('render-process-gone', clear).once('destroyed', dispose);
    return dispose;
  }

  dispose(): void {
    this.disposed = true; this.contexts.dispose(); this.messaging.dispose();
    ipcMain.off(channels.plan, this.plan); ipcMain.removeHandler(channels.message);
    ipcMain.off(channels.port, this.port); ipcMain.off(channels.answer, this.answer);
    for (const document of this.documents.values()) this.forget(document);
    this.states.clear();
  }

  private enabled(extension: Extension): boolean {
    return !this.disposed && extension.manifest.permissions?.includes('userScripts') && this.options.allowed(extension.id);
  }

  private hostAccess(extension: Extension, url: string): boolean {
    // File URLs and privileged browser/extension pages have no access grant in this browser.
    return /^https?:/.test(url) && matchesHost(url, extension.manifest.host_permissions ?? []);
  }

  private async call(extension: Extension, key: string, method: string, args: unknown[]): Promise<unknown> {
    if (method === 'messageAnswer') { this.messaging.answer(extension.id, key, args[0]); return; }
    if (method === 'port') { this.messaging.fromExtension(extension.id, key, args[0]); return; }
    if (method === 'sendMessage') return this.sendMessage(extension, args);
    if (!this.enabled(extension)) throw new Error(userScriptsMethodUnavailable(method));
    if (method === 'execute') return this.execute(extension, args[0]);
    const operation = this.queue.catch(() => undefined).then(async () => {
      if (!this.enabled(extension) || !this.options.resolve(`chrome-extension://${extension.id}/`)) throw new Error(userScriptsMethodUnavailable(method));
      const state = this.states.get(extension.id) ?? this.store.read(extension.id);
      const raw = args[0];
      let next = state;
      switch (method) {
        case 'getScripts': return selectScripts(state.scripts, raw);
        case 'getWorldConfigurations': return state.worlds;
        case 'register': {
          const scripts = normalizeRegistrations(raw, new Set(state.scripts.map((script) => script.id)));
          for (const script of scripts) scriptSources(extension, script.js);
          next = { ...state, scripts: [...state.scripts, ...scripts] }; break;
        }
        case 'update': {
          const scripts = applyUpdates(state.scripts, raw);
          for (const script of scripts) scriptSources(extension, script.js);
          next = { ...state, scripts }; break;
        }
        case 'unregister': {
          const selected = new Set(selectScripts(state.scripts, raw).map((script) => script.id));
          if (record(raw) && Array.isArray(raw.ids) && raw.ids.some((id) => !selected.has(id))) throw new Error('Nonexistent script ID.');
          next = { ...state, scripts: state.scripts.filter((script) => !selected.has(script.id)) }; break;
        }
        case 'configureWorld': next = { ...state, worlds: setWorldConfig(state.worlds, normalizeWorldConfig(raw)) }; break;
        case 'resetWorldConfiguration': next = { ...state, worlds: resetWorldConfig(state.worlds, raw) }; break;
        default: throw new Error(`Unknown userScripts method '${method}'.`);
      }
      await this.store.write(extension.id, next);
      if (!this.disposed && this.options.resolve(`chrome-extension://${extension.id}/`)) this.states.set(extension.id, next);
    });
    this.queue = operation;
    return operation;
  }

  private readonly plan = (event: IpcMainEvent) => {
    const plans: WireExtensionPlan[] = [];
    const document = this.document(event, true);
    if (document) for (const extension of this.options.session.extensions.getAllExtensions()) {
      if (!this.enabled(extension) || !this.options.resolve(`chrome-extension://${extension.id}/`)) continue;
      const state = this.states.get(extension.id);
      if (!state) continue;
      const worlds = planUserScripts(state, true, { url: document.frame.url, isTopFrame: document.frame.parent === null }, {
        hostAccess: (url) => this.hostAccess(extension, url), allowFileAccess: false,
      });
      if (!worlds.length) continue;
      try {
        plans.push({ extensionId: extension.id, incognito: false, worlds: worlds.map((world) => ({ ...world,
          scripts: world.scripts.map((script) => ({ id: script.id, runAt: script.runAt, code: scriptSources(extension, script.js) })),
        })) });
        document.worlds.set(extension.id, new Set(worlds.filter((world) => world.world === 'USER_SCRIPT').map((world) => world.worldId)));
      } catch (error) { console.warn('[browser] User script source unavailable', error); }
    }
    event.returnValue = plans;
  };

  private document(event: IpcMainEvent | IpcMainInvokeEvent, create = false): Document | null {
    const frame = event.senderFrame;
    if (event.sender.session !== this.options.session || !this.options.ownsGuest(event.sender) || !frame || frame.isDestroyed()) return null;
    const key = `${event.sender.id}:${frame.processId}:${frame.routingId}`;
    if (create) {
      const previous = this.documents.get(key);
      if (previous) this.forget(previous);
      const { port1, port2 } = new MessageChannelMain();
      const document: Document = { contents: event.sender, frame, key, id: randomUUID(), worlds: new Map(), lifetime: port1 };
      this.documents.set(key, document);
      // WebFrameMain has no destruction event. Its preload's lifetime port closes
      // with the actual document, without invalidating downloads/cancelled navigations.
      port1.once('close', () => this.forget(document));
      port1.start();
      frame.postMessage(channels.document, document.id, [port2]);
    }
    const document = this.documents.get(key);
    return document?.frame === frame ? document : null;
  }

  private worldExtension(document: Document, raw: unknown): Extension | null {
    if (!this.live(document) || !record(raw) || typeof raw.extensionId !== 'string' || !(raw.worldId === null || typeof raw.worldId === 'string')) return null;
    const extension = this.options.resolve(`chrome-extension://${raw.extensionId}/`);
    const state = this.states.get(raw.extensionId);
    return extension && state && this.enabled(extension) && this.hostAccess(extension, document.frame.url)
      && document.worlds.get(extension.id)?.has(raw.worldId)
      && worldConfigFor(state.worlds, raw.worldId ?? undefined).messaging ? extension : null;
  }

  private sender(document: Document, id: string): unknown {
    return { id, url: document.frame.url, origin: document.frame.origin, frameId: frameId(document.frame), documentId: document.id,
      documentLifecycle: 'active', tab: { id: document.contents.id, url: document.contents.getURL(), title: document.contents.getTitle(), incognito: false } };
  }

  private readonly message = async (event: IpcMainInvokeEvent, raw: unknown): Promise<WorldMessageResult> => {
    const document = this.document(event);
    const extension = document && this.worldExtension(document, raw);
    if (!document || !extension || !record(raw)) return { error: NO_RECEIVER_ERROR };
    const endpoints = await this.contexts.endpoints(extension.id);
    if (!this.worldExtension(document, raw) || this.documents.get(document.key) !== document) return { error: NO_RECEIVER_ERROR };
    return this.messaging.message(extension.id, document.key, endpoints, raw.message, this.sender(document, extension.id));
  };

  private readonly port = (event: IpcMainEvent, raw: unknown) => {
    const document = this.document(event);
    if (!document || !record(raw) || typeof raw.portId !== 'string' || raw.portId.length > 256) return;
    if (raw.kind !== 'connect') {
      if (raw.kind === 'message' || raw.kind === 'disconnect') this.messaging.fromDocument(document.key, raw as unknown as PortWire);
      return;
    }
    const extension = this.worldExtension(document, raw);
    const send = (wire: PortWire) => { try { if (!document.frame.isDestroyed()) document.frame.send(channels.port, wire); } catch { /* document closed */ } };
    if (!extension) { send({ kind: 'disconnect', portId: raw.portId, error: NO_RECEIVER_ERROR }); return; }
    const endpoints = this.contexts.endpoints(extension.id);
    this.messaging.connect(extension.id, { key: document.key, send }, raw.portId, endpoints, typeof raw.name === 'string' ? raw.name : '', this.sender(document, extension.id));
  };

  private readonly answer = (event: IpcMainEvent, raw: unknown) => {
    const document = this.document(event);
    if (!document || !record(raw) || typeof raw.token !== 'number' || this.pending.get(raw.token)?.document !== document) return;
    this.finish(raw.token, raw as unknown as WireAnswer);
  };

  private request(document: Document, id: string, channel: string, value: object, tokens?: Set<number>): Promise<WireAnswer | null> {
    return new Promise((resolve) => {
      const token = ++this.sequence;
      const timer = setTimeout(() => this.finish(token, null), 30_000);
      tokens?.add(token);
      this.pending.set(token, { document, extensionId: id, resolve: (answer) => { tokens?.delete(token); resolve(answer); }, timer });
      try { document.frame.send(channel, { ...value, token }); } catch { this.finish(token, null); }
    });
  }

  private async sendMessage(extension: Extension, args: unknown[]): Promise<unknown> {
    const [tabId, message, filter] = args;
    if (!this.enabled(extension)) return { handled: false, responded: false };
    const documents = [...this.documents.values()].filter((document) => this.live(document) && document.contents.id === tabId && document.worlds.has(extension.id)
      && this.hostAccess(extension, document.frame.url) && (!record(filter) || (filter.frameId === undefined || filter.frameId === frameId(document.frame))
        && (filter.documentId === undefined || filter.documentId === document.id)));
    const tokens = new Set<number>();
    try {
      return await firstDeliveryResponse(documents.map((document) => this.request(document, extension.id, channels.deliver, {
        extensionId: extension.id, message, sender: { id: extension.id, origin: `chrome-extension://${extension.id}`, url: `chrome-extension://${extension.id}/` },
      }, tokens)));
    } finally {
      // The first response closes this request; discard other frames' timers and late replies.
      for (const token of tokens) this.finish(token, null);
    }
  }

  private async execute(extension: Extension, raw: unknown): Promise<unknown> {
    const injection = normalizeInjection(raw);
    const contents = webContents.fromId(injection.target.tabId);
    if (!contents || !this.options.ownsGuest(contents)) throw new Error('No tab with the requested ID.');
    const state = this.states.get(extension.id);
    if (!state) throw new Error('Extension unavailable.');
    const frames = contents.mainFrame.framesInSubtree.filter((frame) => !frame.isDestroyed()
      && (injection.target.allFrames || injection.target.frameIds?.includes(frameId(frame))
        || injection.target.documentIds?.some((id) => this.documents.get(`${contents.id}:${frame.processId}:${frame.routingId}`)?.id === id)
        || !injection.target.frameIds && !injection.target.documentIds && frame.parent === null));
    const code = scriptSources(extension, injection.js);
    const config = worldConfigFor(state.worlds, injection.worldId);
    return Promise.all(frames.map(async (frame) => {
      const targetFrameId = frameId(frame);
      if (!this.hostAccess(extension, frame.url)) throw new Error(`Cannot access contents of url '${frame.url}'.`);
      const document = this.documents.get(`${contents.id}:${frame.processId}:${frame.routingId}`);
      if (!document) throw new Error('Document unavailable.');
      const worlds = document.worlds.get(extension.id) ?? new Set();
      if (injection.world === 'USER_SCRIPT') worlds.add(injection.worldId ?? null);
      document.worlds.set(extension.id, worlds);
      const answer = await this.request(document, extension.id, channels.execute, {
        extensionId: extension.id, world: injection.world, worldId: injection.worldId ?? null, csp: config.csp ?? DEFAULT_USER_SCRIPT_CSP,
        messaging: config.messaging, incognito: false, code, injectImmediately: injection.injectImmediately,
      });
      return { frameId: targetFrameId, documentId: document.id, ...(answer?.error ? { error: answer.error }
        : answer ? { result: answer.result } : { error: 'Document closed.' }) };
    }));
  }

  private finish(token: number, answer: WireAnswer | null): void {
    const pending = this.pending.get(token);
    if (!pending) return;
    this.pending.delete(token); clearTimeout(pending.timer); pending.resolve(answer);
  }

  private forget(document: Document): void {
    // A late close from the previous preload must not delete a replacement document.
    if (this.documents.get(document.key) !== document) return;
    this.documents.delete(document.key); this.messaging.forgetDocument(document.key);
    document.lifetime.removeAllListeners('close'); document.lifetime.close();
    for (const [token, pending] of this.pending) if (pending.document === document) this.finish(token, null);
  }

  private live(document: Document): boolean {
    if (this.documents.get(document.key) === document && !document.contents.isDestroyed() && !document.frame.isDestroyed()) return true;
    this.forget(document);
    return false;
  }
}
