import {
  RUNTIME_LOCAL_ATTACHMENT_LINK_PATH,
  type DesktopImageDataResult,
  type DesktopRuntimeEventPayload,
  type RuntimeDataMigrationReadiness,
  type RuntimeAttachmentLinkInput,
  type RuntimeAttachmentUploadInput,
  type RuntimeEvent,
  type RuntimeEventResync,
  type RuntimePluginInstallResult,
  type RuntimeFeatureOperationResponse,
  type RuntimeRequestInput,
  type RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { WebContents } from 'electron';
import { installLocalPlugin } from '@setsuna-desktop/feature-plugin-management/contracts';
import { KERNEL_FEATURE_OPERATION_ERRORS } from '@setsuna-desktop/feature-core/operation';
import type {
  FeatureCredentialBackup,
  PortableFeatureSettingsDocument,
  PortableFeatureSettingsRestoreTarget,
} from '@setsuna-desktop/feature-core/settings';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { RuntimeEventBatcher } from './runtime-event-batcher.js';
import { fetchRuntimeResponse } from './runtime-request.js';
import { readRuntimeProgressResponse } from './runtime-progress-response.js';
import { RuntimeProcess, type RuntimeProcessOptions } from './runtime-process.js';
import { abortableDelay } from './runtime-process-control.js';
export { stopRuntimeChild, type RuntimeChildProcess } from './runtime-process-control.js';
export {
  resolveBuiltinPluginsDir, resolveBuiltinSkillsDir, resolvePackagedRuntimeEntry,
  resolveRuntimeNodeExecutable, resolveRuntimeSpawnCwd, runtimeProcessEnvironment,
} from './runtime-process-environment.js';

type RuntimeHostOptions = RuntimeProcessOptions & {
  runtimeRequestRetryDelayMs?: number;
  sseRetryBaseDelayMs?: number;
};

type Subscription = {
  abort: AbortController;
  batcher: RuntimeEventBatcher;
  handleWebContentsDestroyed: () => void;
  webContents: WebContents;
};

const DEFAULT_SSE_RETRY_BASE_DELAY_MS = 250;
const MAX_SSE_RETRY_DELAY_MS = 5_000;

/**
 * 管理本地 runtime 子进程，并把它的 HTTP/SSE 能力收敛到 Electron bridge 后面。
 */
export class RuntimeHost {
  private readonly process: RuntimeProcess;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly rendererRequests = new Map<string, AbortController>();

  constructor(private readonly options: RuntimeHostOptions) {
    this.process = new RuntimeProcess(options);
  }

  start(): Promise<void> {
    return this.process.start();
  }

  async stop(): Promise<void> {
    for (const subscriptionId of this.subscriptions.keys()) this.unsubscribe(subscriptionId);
    await this.process.stop();
  }

  /**
   * 通过受限 path 代理一次 renderer 到 runtime 的请求。
   *
   * @param input renderer 传来的 method、path 和 body。
   */
  async request<T = unknown>(input: RuntimeRequestInput): Promise<T> {
    const safePath = normalizeRuntimePath(input.path);
    if (!input.requestId) return this.sendRequest(input, safePath);
    const requestId = normalizeRendererRequestId(input.requestId);
    if (this.rendererRequests.has(requestId)) throw new Error('Runtime request ID is already active.');
    const controller = new AbortController();
    this.rendererRequests.set(requestId, controller);
    try {
      return await this.sendRequest(input, safePath, controller.signal);
    } finally {
      if (this.rendererRequests.get(requestId) === controller) this.rendererRequests.delete(requestId);
    }
  }

  cancelRequest(requestId: string): boolean {
    const controller = this.rendererRequests.get(normalizeRendererRequestId(requestId));
    if (!controller) return false;
    controller.abort(new Error('Renderer cancelled the runtime request.'));
    return true;
  }

  /** Main-only progress callbacks never cross the renderer's generic request bridge. */
  requestWithProgress(input: RuntimeRequestInput, options: { signal?: AbortSignal; onProgress: (value: unknown) => void }): Promise<unknown> {
    return this.sendRequest(input, normalizeRuntimePath(input.path), options.signal, options.onProgress);
  }

  /** Installs a native-picker-selected bundle through a main-only runtime route. */
  async installLocalPluginBundle(sourcePath: string): Promise<RuntimePluginInstallResult> {
    if (!path.isAbsolute(sourcePath)) throw new Error('Plugin bundle path must be absolute.');
    const input = installLocalPlugin.input.parse({ path: sourcePath });
    const result = await this.sendRequest<unknown>({
      path: installLocalPlugin.path,
      method: installLocalPlugin.method,
      body: input,
    }, installLocalPlugin.path);
    return installLocalPlugin.output.parse(result);
  }

  private async sendRequest<T>(
    input: RuntimeRequestInput,
    safePath: string,
    signal?: AbortSignal,
    onProgress?: (value: unknown) => void,
  ): Promise<T> {
    const method = input.method ?? 'GET';
    const requestLabel = `${method} ${safePath}`;
    // Main keeps the runtime token and port private for both renderer-proxied and internal requests.
    let response: Response;
    try {
      response = await fetchRuntimeResponse(
        `http://127.0.0.1:${this.process.port}${safePath}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.process.token}`,
            'Content-Type': 'application/json',
            ...(onProgress ? { Accept: 'application/x-ndjson' } : {}),
          },
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
          signal,
        },
        {
          label: requestLabel,
          retryDelayMs: this.options.runtimeRequestRetryDelayMs,
          retryOnce: !onProgress && method === 'GET',
          runtimeState: () => this.process.state,
        },
      );
    } catch (error) {
      if (signal?.aborted && input.responseMode === 'feature-operation') {
        return runtimeFeatureOperationCancelledResponse() as T;
      }
      throw error;
    }
    if (onProgress) return readRuntimeProgressResponse(response, onProgress) as Promise<T>;
    if (input.responseMode === 'feature-operation') {
      return runtimeFeatureOperationResponse(response) as Promise<T>;
    }
    return runtimeJsonResponse<T>(response, requestLabel);
  }

  prepareDataMigration(): Promise<RuntimeDataMigrationReadiness> {
    return this.request({
      path: '/v1/data-migration/prepare',
      method: 'POST',
    });
  }

  async cancelDataMigrationPreparation(): Promise<void> {
    await this.request({
      path: '/v1/data-migration/prepare',
      method: 'DELETE',
    });
  }

  /** Main-only quiescence gate used to take a consistent encrypted sync snapshot. */
  prepareWebDavSync(): Promise<RuntimeDataMigrationReadiness> {
    const requestPath = '/internal/webdav-sync/prepare';
    return this.sendRequest({ path: requestPath, method: 'POST' }, requestPath);
  }

  async releaseWebDavSyncPreparation(): Promise<void> {
    const requestPath = '/internal/webdav-sync/prepare';
    await this.sendRequest({ path: requestPath, method: 'DELETE' }, requestPath);
  }

  /** Reads schema-validated portable Feature documents while the WebDAV gate is held. */
  async exportPortableFeatureSettings(): Promise<readonly PortableFeatureSettingsDocument[]> {
    const requestPath = '/internal/webdav-sync/feature-settings';
    const response = await this.sendRequest<Readonly<{
      documents: readonly PortableFeatureSettingsDocument[];
    }>>({ path: requestPath, method: 'GET' }, requestPath);
    return response.documents;
  }

  /** Exports only Feature secrets explicitly opted into encrypted credential backup. */
  async exportFeatureCredentialBackups(): Promise<readonly FeatureCredentialBackup[]> {
    const requestPath = '/internal/webdav-sync/feature-credentials';
    const response = await this.sendRequest<Readonly<{
      credentials: readonly FeatureCredentialBackup[];
    }>>({ path: requestPath, method: 'GET' }, requestPath);
    return response.credentials;
  }

  /** Lets the live Runtime validate and stage Feature-owned settings before it is stopped. */
  async stagePortableFeatureSettingsRestore(input: Readonly<{
    documents: readonly PortableFeatureSettingsDocument[];
    credentials: readonly FeatureCredentialBackup[];
    stagingRoot: string;
  }>): Promise<readonly PortableFeatureSettingsRestoreTarget[]> {
    const requestPath = '/internal/webdav-sync/feature-settings/restore-stage';
    const response = await this.sendRequest<Readonly<{
      targets: readonly PortableFeatureSettingsRestoreTarget[];
    }>>({
      path: requestPath,
      method: 'POST',
      body: input,
    }, requestPath);
    return response.targets;
  }

  /** Registers a renderer-selected local file without copying its bytes into runtime storage. */
  linkAttachment(input: RuntimeAttachmentLinkInput): Promise<RuntimeStoredMessageAttachment> {
    if (!path.isAbsolute(input.path)) throw new Error('Attachment path must be absolute.');
    return this.sendRequest<RuntimeStoredMessageAttachment>({
      path: RUNTIME_LOCAL_ATTACHMENT_LINK_PATH,
      method: 'POST',
      body: input,
    }, RUNTIME_LOCAL_ATTACHMENT_LINK_PATH);
  }

  /** Stores clipboard content without a local path (pasted images or text). */
  async uploadAttachment(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment> {
    if (!(input.data instanceof Uint8Array)) throw new Error('Attachment bytes are invalid.');
    const params = new URLSearchParams({ name: input.name, type: input.type });
    const response = await fetch(`http://127.0.0.1:${this.process.port}/v1/attachments?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.process.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from(input.data),
    });
    return runtimeJsonResponse<RuntimeStoredMessageAttachment>(response, 'POST /v1/attachments');
  }

  /** Reads one thread-owned raster image without exposing the runtime token or its local path. */
  async readAttachmentImage(threadId: string, assetId: string): Promise<DesktopImageDataResult> {
    const encodedThreadId = encodeURIComponent(threadId.trim());
    const encodedAssetId = encodeURIComponent(assetId.trim());
    if (!encodedThreadId || !encodedAssetId) return { ok: false, error: 'Image attachment id is invalid.' };
    const requestPath = `/v1/threads/${encodedThreadId}/attachments/${encodedAssetId}/image`;
    const response = await fetchRuntimeResponse(
      `http://127.0.0.1:${this.process.port}${requestPath}`,
      { headers: { Authorization: `Bearer ${this.process.token}` } },
      {
        label: `GET ${requestPath}`,
        retryDelayMs: this.options.runtimeRequestRetryDelayMs,
        retryOnce: true,
        runtimeState: () => this.process.state,
      },
    );
    if (!response.ok) {
      return { ok: false, error: await runtimeResponseError(response, 'Image attachment is unavailable.') };
    }
    const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!runtimeImageMimeTypes.has(type)) {
      return { ok: false, error: 'Runtime returned an unsupported image type.' };
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (!data.byteLength) {
      return { ok: false, error: 'Runtime returned invalid image bytes.' };
    }
    return { ok: true, data, type };
  }

  /**
   * 为指定线程建立 SSE 订阅，并把事件转发给 renderer。
   *
   * @param webContents 接收 runtime:event 的 renderer webContents。
   * @param input 线程 ID 和可选续订 seq。
   */
  subscribeEvents(webContents: WebContents, input: { threadId: string; sinceSeq?: number }): string {
    const subscriptionId = randomUUID();
    const abort = new AbortController();
    const batcher = new RuntimeEventBatcher((batch) => {
      const payload: DesktopRuntimeEventPayload = { batch, subscriptionId };
      sendRuntimeEventPayload(webContents, payload);
    });
    const handleWebContentsDestroyed = () => this.unsubscribe(subscriptionId);
    // 每个 renderer 订阅都有独立 AbortController，窗口切换或销毁时可以精确断开。
    this.subscriptions.set(subscriptionId, {
      abort,
      batcher,
      handleWebContentsDestroyed,
      webContents,
    });
    webContents.once('destroyed', handleWebContentsDestroyed);
    void this.readSse(subscriptionId, webContents, input, abort.signal);
    return subscriptionId;
  }

  /**
   * 取消指定 SSE 订阅。
   *
   * @param subscriptionId subscribeEvents 返回的订阅 ID。
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    subscription?.abort.abort();
    subscription?.batcher.cancel();
    subscription?.webContents.removeListener('destroyed', subscription.handleWebContentsDestroyed);
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * 读取 runtime SSE 流并转成 renderer 事件。
   *
   * @param subscriptionId 当前订阅 ID。
   * @param webContents 接收事件的 renderer webContents。
   * @param input 线程 ID 和续订 seq。
   * @param signal 用于取消 SSE 读取的信号。
   */
  private async readSse(
    subscriptionId: string,
    webContents: WebContents,
    input: { threadId: string; sinceSeq?: number },
    signal: AbortSignal,
  ): Promise<void> {
    // Advance outside the connection promise: a killed process can deliver events
    // and then reset the socket without ever resolving readSseConnection().
    const cursor = { seq: input.sinceSeq };
    const baseRetryDelay = Math.max(1, this.options.sseRetryBaseDelayMs ?? DEFAULT_SSE_RETRY_BASE_DELAY_MS);
    let retryDelay = baseRetryDelay;
    try {
      while (!signal.aborted && !webContents.isDestroyed()) {
        let disconnectError: unknown = new Error('Runtime SSE disconnected.');
        try {
          await this.readSseConnection(subscriptionId, webContents, input.threadId, cursor, signal);
          retryDelay = baseRetryDelay;
        } catch (error) {
          disconnectError = error;
        }
        if (signal.aborted || webContents.isDestroyed()) break;
        this.subscriptions.get(subscriptionId)?.batcher.flush();
        const payload: DesktopRuntimeEventPayload = {
          subscriptionId,
          error: `${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)} Reconnecting...`,
        };
        sendRuntimeEventPayload(webContents, payload);
        await abortableDelay(retryDelay, signal);
        retryDelay = Math.min(retryDelay * 2, MAX_SSE_RETRY_DELAY_MS);
      }
    } finally {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription?.abort.signal === signal) {
        subscription.batcher.cancel();
        subscription.webContents.removeListener('destroyed', subscription.handleWebContentsDestroyed);
        this.subscriptions.delete(subscriptionId);
      }
    }
  }

  private async readSseConnection(
    subscriptionId: string,
    webContents: WebContents,
    threadId: string,
    cursor: { seq: number | undefined },
    signal: AbortSignal,
  ): Promise<void> {
    const params = new URLSearchParams();
    if (typeof cursor.seq === 'number') params.set('sinceSeq', String(cursor.seq));
    const suffix = params.size ? `?${params}` : '';
    // SSE 连接由 main 持有，renderer 重载后可以续订，但不会拿到 runtime token。
    const response = await fetch(
      `http://127.0.0.1:${this.process.port}/v1/threads/${encodeURIComponent(threadId)}/events${suffix}`,
      {
        headers: { Authorization: `Bearer ${this.process.token}` },
        signal,
      },
    );
    if (!response.ok || !response.body) throw new Error(`Runtime SSE failed: ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // SSE 按空行分帧；buffer 保留半截事件，避免流式读取拆包时丢事件。
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const frame = parseSseChunk(chunk);
          if (frame?.resync) {
            if (frame.resync.thread.id !== threadId) continue;
            if (webContents.isDestroyed()) return;
            this.subscriptions.get(subscriptionId)?.batcher.resync(frame.resync);
            cursor.seq = frame.resync.thread.lastSeq;
            continue;
          }
          const event = frame?.event;
          if (event && (cursor.seq === undefined || event.seq > cursor.seq)) {
            if (webContents.isDestroyed()) return;
            this.subscriptions.get(subscriptionId)?.batcher.enqueue(event);
            cursor.seq = event.seq;
          }
        }
      }
    } finally {
      // A reconnect resumes from cursor.seq, so every accepted event must leave the
      // pending IPC batch before this connection can advance to a new one.
      this.subscriptions.get(subscriptionId)?.batcher.flush();
    }
  }
}

async function runtimeJsonResponse<T>(response: Response, requestLabel: string): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) as { error?: string } : null;
  if (!response.ok) {
    const reason = body?.error ?? `Runtime request failed: ${response.status}`;
    throw new Error(`${reason} (${requestLabel})`);
  }
  return body as T;
}

async function runtimeFeatureOperationResponse(
  response: Response,
): Promise<RuntimeFeatureOperationResponse> {
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : null;
  if (response.ok) return Object.freeze({ ok: true, value: body });
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return Object.freeze({
    ok: false,
    status: response.status,
    error: Object.freeze({
      code: typeof record.code === 'string' ? record.code : 'INTERNAL',
      message: typeof record.error === 'string' ? record.error : 'Feature operation failed.',
      retryable: record.retryable === true,
      ...('details' in record ? { details: record.details } : {}),
    }),
  });
}

function runtimeFeatureOperationCancelledResponse(): RuntimeFeatureOperationResponse {
  return Object.freeze({
    ok: false,
    status: KERNEL_FEATURE_OPERATION_ERRORS.OPERATION_CANCELLED.status,
    error: Object.freeze({
      code: 'OPERATION_CANCELLED',
      message: 'Feature operation was cancelled.',
      retryable: false,
    }),
  });
}

function normalizeRendererRequestId(value: string): string {
  const requestId = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) throw new Error('Runtime request ID is invalid.');
  return requestId;
}

const runtimeImageMimeTypes = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

async function runtimeResponseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRuntimePath(value: string): string {
  // bridge 必须是窄白名单，避免 renderer 借 runtime host 代理任意 localhost 路径。
  if (!value.startsWith('/')) throw new Error('Runtime path must be absolute.');
  const runtimeOrigin = new URL('http://setsuna-runtime.local');
  let normalized: URL;
  try {
    normalized = new URL(value, runtimeOrigin);
  } catch {
    throw new Error('Runtime path is not allowed.');
  }
  // Validate the canonical URL. WHATWG URL parsing collapses literal and encoded
  // dot segments, preventing an allowed /v1 path from reaching a main-only route.
  if (normalized.origin !== runtimeOrigin.origin || normalized.hash) {
    throw new Error('Runtime path is not allowed.');
  }
  if (!normalized.pathname.startsWith('/v1/') && normalized.pathname !== '/health') {
    throw new Error('Runtime path is not allowed.');
  }
  // Local bundle installation accepts an absolute filesystem path selected by
  // main. Keep the typed Feature route unreachable through the renderer proxy.
  if (normalized.pathname === installLocalPlugin.path) {
    throw new Error('Runtime path is not allowed.');
  }
  return `${normalized.pathname}${normalized.search}`;
}

type RuntimeSseFrame =
  | { event: RuntimeEvent; resync?: never }
  | { event?: never; resync: RuntimeEventResync };

function parseSseChunk(chunk: string): RuntimeSseFrame | null {
  const eventName = chunk.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
  const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return null;
  if (eventName === 'runtime-resync') {
    return { resync: JSON.parse(dataLine.slice(6)) as RuntimeEventResync };
  }
  if (eventName === 'runtime-event') {
    return { event: JSON.parse(dataLine.slice(6)) as RuntimeEvent };
  }
  return null;
}

function sendRuntimeEventPayload(
  webContents: WebContents,
  payload: DesktopRuntimeEventPayload,
): void {
  if (webContents.isDestroyed()) return;
  try {
    webContents.send('runtime:event', payload);
  } catch (error) {
    // Destruction can race a frame-sized batch timer; the subscription cleanup
    // remains authoritative and a renderer IPC race must not crash Electron main.
    if (!webContents.isDestroyed()) console.warn('[runtime] failed to deliver event batch', error);
  }
}
