import type { AssistantWebSocket } from '../../contracts/index.js';
import type { QqApiClient } from './qq-api.js';

/** GROUP_AND_C2C_EVENT: private chat and group @ messages. */
const QQ_INTENTS = 1 << 25;
const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000] as const;
/** Invalid credentials, intents or a banned bot cannot recover by reconnecting quickly. */
const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4004, 4010, 4011, 4012, 4013, 4014, 4914, 4915]);

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

export type QqGatewayStatus = { state: 'connecting' | 'connected' | 'error'; error?: string };

type GatewayPayload = { op?: unknown; d?: unknown; s?: unknown; t?: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One QQ gateway session: Hello → Identify (or Resume) → heartbeats → dispatches. Disconnects resume
 * the previous session when possible and back off between attempts; stop() ends everything.
 */
export class QqGatewaySession {
  private socket: AssistantWebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private failures = 0;
  private stopped = false;
  private awaitingHeartbeat = false;

  constructor(private readonly options: {
    api: Pick<QqApiClient, 'gatewayUrl' | 'accessToken'>;
    openWebSocket(url: string): AssistantWebSocket;
    onDispatch(type: string, data: unknown): void;
    onStatus(status: QqGatewayStatus): void;
  }) {}

  start(): void {
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'stopped');
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.options.onStatus({ state: 'connecting' });
    try {
      const url = await this.options.api.gatewayUrl();
      if (this.stopped) return;
      const socket = this.options.openWebSocket(url);
      this.socket = socket;
      // Handlers ignore events from sockets that were replaced or stopped.
      socket.onmessage = (event) => { if (this.socket === socket) this.receive(socket, event.data); };
      socket.onclose = (event) => { if (this.socket === socket) this.closed(event.code, event.reason); };
      socket.onerror = () => undefined;
    } catch (error) {
      this.retry(errorMessage(error));
    }
  }

  private receive(socket: AssistantWebSocket, data: unknown): void {
    let payload: GatewayPayload;
    try { payload = JSON.parse(typeof data === 'string' ? data : String(data)) as GatewayPayload; }
    catch { return; }
    if (typeof payload.s === 'number') this.seq = payload.s;
    switch (payload.op) {
      case OP_HEARTBEAT_ACK:
        this.awaitingHeartbeat = false;
        return;
      case OP_HELLO: {
        const interval = Number((payload.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval);
        this.startHeartbeat(socket, Number.isFinite(interval) && interval > 0 ? interval : 41_250);
        void this.identify(socket);
        return;
      }
      case OP_DISPATCH:
        this.dispatch(typeof payload.t === 'string' ? payload.t : '', payload.d);
        return;
      case OP_RECONNECT:
        socket.close(4000, 'reconnect requested');
        return;
      case OP_INVALID_SESSION:
        this.sessionId = null;
        this.seq = null;
        socket.close(4000, 'invalid session');
        return;
      default:
    }
  }

  private async identify(socket: AssistantWebSocket): Promise<void> {
    try {
      const token = `QQBot ${await this.options.api.accessToken()}`;
      if (this.socket !== socket) return;
      socket.send(JSON.stringify(this.sessionId && this.seq !== null
        ? { op: OP_RESUME, d: { token, session_id: this.sessionId, seq: this.seq } }
        : { op: OP_IDENTIFY, d: { token, intents: QQ_INTENTS, shard: [0, 1], properties: {} } }));
    } catch (error) {
      this.options.onStatus({ state: 'error', error: errorMessage(error) });
      socket.close(4000, 'identify failed');
    }
  }

  private dispatch(type: string, data: unknown): void {
    if (type === 'READY' || type === 'RESUMED') {
      if (type === 'READY') {
        const sessionId = (data as { session_id?: unknown } | undefined)?.session_id;
        this.sessionId = typeof sessionId === 'string' ? sessionId : null;
      }
      this.failures = 0;
      this.options.onStatus({ state: 'connected' });
      return;
    }
    this.options.onDispatch(type, data);
  }

  private closed(code: number, reason: string): void {
    this.socket = null;
    this.stopHeartbeat();
    if (this.stopped) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      this.sessionId = null;
      this.failures = RECONNECT_DELAYS_MS.length - 1;
    }
    this.retry(reason || `QQ 连接已断开（${code}）`);
  }

  private retry(error: string): void {
    if (this.stopped) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.failures, RECONNECT_DELAYS_MS.length - 1)];
    this.failures += 1;
    this.options.onStatus({ state: this.failures > 1 ? 'error' : 'connecting', error });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(socket: AssistantWebSocket, interval: number): void {
    this.stopHeartbeat();
    this.awaitingHeartbeat = false;
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket) return;
      if (this.awaitingHeartbeat) { socket.close(4000, 'heartbeat acknowledgement timed out'); return; }
      this.awaitingHeartbeat = true;
      socket.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.seq }));
    }, interval);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
