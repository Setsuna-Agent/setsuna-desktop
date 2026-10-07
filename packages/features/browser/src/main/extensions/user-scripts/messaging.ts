import { randomUUID } from 'node:crypto';
import { NO_RECEIVER_ERROR, PORT_CLOSED_ERROR, type PortWire, type UserScriptsExtensionEvent, type WireAnswer, type WorldMessageResult } from '../../../contracts/user-scripts.js';

/** A silent frame must not delay a response from another frame. */
export function firstDeliveryResponse(deliveries: readonly Promise<WireAnswer | null>[]): Promise<Pick<WireAnswer, 'handled' | 'responded' | 'result'>> {
  return new Promise((resolve) => {
    let remaining = deliveries.length;
    let handled = false;
    if (!remaining) { resolve({ handled, responded: false }); return; }
    for (const delivery of deliveries) void delivery.then((answer) => {
      if (answer?.responded === true) { resolve(answer); return; }
      handled ||= answer?.handled === true;
      if (--remaining === 0) resolve({ handled, responded: false });
    });
  });
}

export interface ScriptEndpoint {
  key: string;
  send(event: UserScriptsExtensionEvent): void;
  hold?(): () => void;
}
export interface ScriptDocument {
  key: string;
  send(wire: PortWire): void;
}
type PendingMessage = { extensionId: string; documentKey: string; release: (() => void)[]; remaining: Set<string>; resolve(value: WorldMessageResult): void; timer: ReturnType<typeof setTimeout> };
type PortReceiver = { endpoint: ScriptEndpoint; accepted: boolean; buffered: unknown[]; release?: () => void };
type Port = {
  id: string; extensionId: string; document: ScriptDocument; pageId: string; receivers: Map<string, PortReceiver>;
  /** Shared only while discovering receivers; afterwards each unaccepted receiver owns its queue. */
  buffered: unknown[] | null; timer: ReturnType<typeof setTimeout>;
};

/** Owns message/port lifetimes; documents and suspended workers must never retain each other. */
export class UserScriptMessaging {
  private sequence = 0;
  private readonly messages = new Map<number, PendingMessage>();
  private readonly ports = new Map<string, Port>();
  private readonly pagePorts = new Map<string, Port>();

  message(extensionId: string, documentKey: string, endpoints: ScriptEndpoint[], message: unknown, sender: unknown): Promise<WorldMessageResult> {
    if (!endpoints.length) return Promise.resolve({ error: NO_RECEIVER_ERROR });
    return new Promise((resolve) => {
      const token = ++this.sequence;
      const timer = setTimeout(() => this.finishMessage(token, { error: PORT_CLOSED_ERROR }), 5 * 60_000);
      this.messages.set(token, { extensionId, documentKey, release: endpoints.flatMap((item) => item.hold ? [item.hold()] : []),
        remaining: new Set(endpoints.map((item) => item.key)), resolve, timer });
      for (const endpoint of endpoints) endpoint.send({ kind: 'message', token, message, sender });
    });
  }

  answer(extensionId: string, endpointKey: string, raw: unknown): void {
    if (!record(raw) || typeof raw.token !== 'number') return;
    const pending = this.messages.get(raw.token);
    if (pending?.extensionId !== extensionId || !pending.remaining.delete(endpointKey)) return;
    if (raw.responded === true) this.finishMessage(raw.token, { result: raw.result });
    else if (!pending.remaining.size) this.finishMessage(raw.token, { error: NO_RECEIVER_ERROR });
  }

  connect(extensionId: string, document: ScriptDocument, pageId: string, endpoints: ScriptEndpoint[] | Promise<ScriptEndpoint[]>, name: string, sender: unknown): void {
    const key = `${document.key}:${pageId}`;
    if (this.pagePorts.has(key)) return;
    const id = randomUUID();
    const port: Port = {
      id, extensionId, document, pageId, receivers: new Map(),
      buffered: [], timer: setTimeout(() => this.close(port, NO_RECEIVER_ERROR), 10_000),
    };
    this.ports.set(id, port); this.pagePorts.set(key, port);
    const offer = (ready: ScriptEndpoint[]) => {
      if (!this.ports.has(id)) return;
      if (!ready.length) { this.close(port, NO_RECEIVER_ERROR); return; }
      // Accepting in one context must not drain another context's initial messages.
      port.receivers = new Map(ready.map((endpoint) => [endpoint.key,
        { endpoint, accepted: false, buffered: [...(port.buffered ?? [])] }]));
      port.buffered = null;
      for (const endpoint of ready) endpoint.send({ kind: 'connect', portId: id, name, sender });
    };
    // A page can post immediately after connect. Allocate its port before waking the worker,
    // so those messages are buffered even while the asynchronous startup is still pending.
    if (Array.isArray(endpoints)) offer(endpoints);
    else void endpoints.then(offer, () => this.close(port, NO_RECEIVER_ERROR));
  }

  fromDocument(documentKey: string, wire: PortWire): void {
    if (wire.kind === 'connect') return;
    const port = this.pagePorts.get(`${documentKey}:${wire.portId}`);
    if (!port) return;
    if (wire.kind === 'disconnect') { this.close(port); return; }
    if (port.buffered !== null) {
      if (port.buffered.length < 100) port.buffered.push(wire.message);
      else this.close(port, PORT_CLOSED_ERROR);
      return;
    }
    for (const receiver of port.receivers.values()) {
      if (receiver.accepted) receiver.endpoint.send({ kind: 'message', portId: port.id, message: wire.message });
      else if (receiver.buffered.length < 100) receiver.buffered.push(wire.message);
      else { this.close(port, PORT_CLOSED_ERROR); return; }
    }
  }

  fromExtension(extensionId: string, endpointKey: string, raw: unknown): void {
    if (!record(raw) || typeof raw.portId !== 'string') return;
    const port = this.ports.get(raw.portId);
    if (port?.extensionId !== extensionId) return;
    const receiver = port.receivers.get(endpointKey);
    if (!receiver) return;
    if (raw.kind === 'disconnect') {
      this.removeReceiver(port, endpointKey);
      return;
    }
    if (raw.kind !== 'accept' && raw.kind !== 'message') return;
    if (!receiver.accepted) {
      receiver.accepted = true; clearTimeout(port.timer);
      receiver.release = receiver.endpoint.hold?.();
      for (const message of receiver.buffered.splice(0)) receiver.endpoint.send({ kind: 'message', portId: port.id, message });
    }
    if (raw.kind === 'message') port.document.send({ kind: 'message', portId: port.pageId, message: raw.message });
  }

  forgetEndpoint(key: string): void {
    for (const [token, pending] of this.messages) {
      if (pending.remaining.delete(key) && !pending.remaining.size) this.finishMessage(token, { error: PORT_CLOSED_ERROR });
    }
    for (const port of [...this.ports.values()]) {
      this.removeReceiver(port, key, PORT_CLOSED_ERROR);
    }
  }

  forgetDocument(key: string): void {
    for (const [token, pending] of this.messages) if (pending.documentKey === key) this.finishMessage(token, { error: PORT_CLOSED_ERROR });
    for (const port of [...this.ports.values()]) if (port.document.key === key) this.close(port);
  }

  forgetExtension(id: string): void {
    for (const [token, pending] of this.messages) if (pending.extensionId === id) this.finishMessage(token, { error: PORT_CLOSED_ERROR });
    for (const port of [...this.ports.values()]) if (port.extensionId === id) this.close(port);
  }

  dispose(): void {
    for (const token of this.messages.keys()) this.finishMessage(token, { error: PORT_CLOSED_ERROR });
    for (const port of [...this.ports.values()]) this.close(port);
  }

  private finishMessage(token: number, value: WorldMessageResult): void {
    const pending = this.messages.get(token);
    if (!pending) return;
    this.messages.delete(token); clearTimeout(pending.timer); pending.resolve(value);
    for (const release of pending.release) release();
  }

  private removeReceiver(port: Port, key: string, error?: string): void {
    const receiver = port.receivers.get(key);
    if (!receiver) return;
    port.receivers.delete(key); receiver.release?.();
    if (!port.receivers.size) this.close(port, error);
  }

  private close(port: Port, error?: string): void {
    if (!this.ports.delete(port.id)) return;
    this.pagePorts.delete(`${port.document.key}:${port.pageId}`); clearTimeout(port.timer);
    port.document.send({ kind: 'disconnect', portId: port.pageId, ...(error ? { error } : {}) });
    for (const { endpoint, release } of port.receivers.values()) {
      endpoint.send({ kind: 'disconnect', portId: port.id }); release?.();
    }
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
