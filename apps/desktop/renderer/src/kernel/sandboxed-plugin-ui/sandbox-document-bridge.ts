import { SANDBOXED_UI_CHANNEL } from './sandbox-document.js';

/** A WindowProxy survives navigation; a document's private MessagePort does not transfer to its successor. */
export class SandboxedUiDocumentBridge {
  readonly id = crypto.randomUUID();
  private controller = new AbortController();
  private port: MessagePort | null = null;
  private loaded = false;
  private receive: ((event: MessageEvent) => void) | null = null;

  get signal(): AbortSignal { return this.controller.signal; }

  start(): void {
    // StrictMode replays mount effects after cleanup without replacing the document.
    if (this.signal.aborted) this.controller = new AbortController();
  }

  listen(receive: (event: MessageEvent) => void): () => void {
    this.receive = receive;
    return () => { if (this.receive === receive) this.receive = null; };
  }

  connect(event: MessageEvent, source: Window | null | undefined): void {
    if (!source || event.source !== source || this.signal.aborted || this.port
      || event.data?.channel !== SANDBOXED_UI_CHANNEL || event.data.type !== 'ready'
      || event.data.documentId !== this.id || event.ports.length !== 1) return;
    this.port = event.ports[0];
    this.port.onmessage = (message) => {
      if (this.signal.aborted) return;
      if (message.data?.channel === SANDBOXED_UI_CHANNEL && message.data.type === 'unload') this.revoke();
      else this.receive?.(message);
    };
    this.port.start();
    this.receive?.(event);
  }

  post(message: Record<string, unknown>): void {
    if (!this.signal.aborted) this.port?.postMessage({ channel: SANDBOXED_UI_CHANNEL, ...message });
  }

  onLoad(): void {
    // pagehide normally revokes at departure; subsequent loads also revoke if the
    // old document did not deliver that notification. Never send data to a WindowProxy.
    if (this.loaded) this.revoke();
    this.loaded = true;
  }

  revoke(): void {
    this.controller.abort();
    if (this.port) { this.port.onmessage = null; this.port.close(); this.port = null; }
  }
}
