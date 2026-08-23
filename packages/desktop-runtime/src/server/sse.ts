import type {
  RuntimeEventResync,
  StoredThreadEvent,
  SweNotification,
} from '@setsuna-desktop/contracts';
import { createSweNotificationMapper, filterSweNotificationsForClientCapabilities } from '@setsuna-desktop/contracts';
import type { ServerResponse } from 'node:http';
import { mapBuiltinFeatureEventToSweCompatibilityEvent } from '../composition/builtin-swe-feature-event-adapters.js';
import { runtimeThreadResponse } from './runtime-thread-response.js';
import type { RuntimeFactory } from './types.js';

const MAX_PENDING_EVENTS = 512;
const HEARTBEAT_INTERVAL_MS = 15_000;

export async function handleSse({
  experimentalApi,
  format,
  response,
  threadId,
  sinceSeq,
  runtime,
}: {
  experimentalApi?: boolean;
  format: RuntimeEventStreamFormat;
  response: ServerResponse;
  threadId: string;
  sinceSeq: number;
  runtime: RuntimeFactory;
}): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();

  const sweMapEvent = format === 'swe' ? createSweNotificationMapper() : null;
  const pending: StoredThreadEvent[] = [];
  let replaying = true;
  let pumping = false;
  let heartbeatBlocked = false;
  let closed = false;
  let processedSeq = format === 'swe' ? 0 : sinceSeq;
  const closeWithError = (error: Error) => {
    if (closed) return;
    closed = true;
    response.destroy(error);
  };
  const writeEvent = async (event: StoredThreadEvent) => {
    if (closed || !responseCanWrite(response)) return;
    if (format === 'swe' && sweMapEvent) {
      const compatibilityEvent = event.type === 'feature.event'
        ? mapBuiltinFeatureEventToSweCompatibilityEvent(event)
        : event.type === 'collaboration.task_created'
          || event.type === 'collaboration.task_status_changed'
          ? null
          : event;
      const notifications = compatibilityEvent ? sweMapEvent(compatibilityEvent) : [];
      if (event.seq > sinceSeq) {
        await writeSweSse(response, notifications, { experimentalApi });
      }
    } else {
      await writeRuntimeSse(response, event);
    }
    processedSeq = event.seq;
  };
  const pump = async () => {
    if (pumping || replaying || closed) return;
    pumping = true;
    try {
      while (pending.length && !closed) {
        const event = pending.shift();
        if (event && event.seq > processedSeq) await writeEvent(event);
      }
    } catch (error) {
      closeWithError(toError(error));
    } finally {
      pumping = false;
      if (pending.length && !closed) void pump();
    }
  };
  const unsubscribe = runtime.eventBus.subscribe(threadId, (event) => {
    if (closed || !responseCanWrite(response) || event.seq <= processedSeq) return;
    pending.push(event);
    if (pending.length > MAX_PENDING_EVENTS) {
      closeWithError(new Error(`Runtime SSE subscriber exceeded ${MAX_PENDING_EVENTS} pending events.`));
      return;
    }
    if (!replaying) void pump();
  });
  const heartbeat = setInterval(() => {
    if (
      !closed
      && !heartbeatBlocked
      && !replaying
      && !pumping
      && !pending.length
      && responseCanWrite(response)
    ) {
      heartbeatBlocked = !response.write(': heartbeat\n\n');
      if (heartbeatBlocked) {
        response.once('drain', () => {
          heartbeatBlocked = false;
        });
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  response.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });

  try {
    // 重放前先订阅。读取日志期间发布的事件会被缓冲，并在重放到达实时边界时按 seq 去重。
    if (format === 'swe') {
      // SWE mapping needs retained lifecycle events from the beginning to rebuild item identity;
      // pruned token deltas are recoverable from canonical completion events.
      const existing = await runtime.threadStore.listEvents(threadId, 0);
      for (const event of existing) {
        if (event.seq <= processedSeq) continue;
        await writeEvent(event);
      }
    } else {
      const replay = await runtime.threadStore.replayEvents(threadId, sinceSeq);
      if (closed) return;
      if (replay.requiresResync) {
        const storedThread = await runtime.threadStore.getThread(threadId);
        if (!storedThread) throw new Error(`Thread not found: ${threadId}`);
        const thread = await runtimeThreadResponse(runtime, storedThread);
        const resync: RuntimeEventResync = {
          reason: 'retention_gap',
          requestedSinceSeq: sinceSeq,
          retainedFromSeq: replay.retainedFromSeq,
          thread,
        };
        await writeSseFrame(response, 'runtime-resync', resync);
        processedSeq = thread.lastSeq;
      } else {
        for (const event of replay.events) {
          if (event.seq <= processedSeq) continue;
          await writeEvent(event);
        }
      }
    }
    pending.sort((left, right) => left.seq - right.seq);
    replaying = false;
    await pump();
  } catch (error) {
    clearInterval(heartbeat);
    unsubscribe();
    closeWithError(toError(error));
  }
}

export function handleAppServerNotificationSse({
  connectionId,
  experimentalApi,
  onClose,
  response,
  runtime,
}: {
  connectionId: string;
  experimentalApi?: boolean;
  onClose?: () => void;
  response: ServerResponse;
  runtime: RuntimeFactory;
}): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();

  const unsubscribe = runtime.appServerNotificationBus.subscribe((notification, metadata) => {
    if (metadata.connectionId !== undefined && metadata.connectionId !== connectionId) return;
    if (!responseCanWrite(response)) return;
    void writeSweSse(response, [notification], { experimentalApi }).catch((error) => {
      response.destroy(toError(error));
    });
  });
  response.on('close', () => {
    unsubscribe();
    onClose?.();
  });
}

export async function publishThreadEventsSince(
  runtime: RuntimeFactory,
  threadId: string,
  sinceSeq: number,
): Promise<void> {
  const events = await runtime.threadStore.listEvents(threadId, sinceSeq);
  for (const event of events) runtime.eventBus.publish(event);
}

export type RuntimeEventStreamFormat = 'runtime' | 'swe';

export function runtimeEventStreamFormat(value: string | null): RuntimeEventStreamFormat {
  return value === 'swe' ? 'swe' : 'runtime';
}

export function runtimeEventStreamExperimentalApi(value: string | null): boolean {
  return value === 'true' || value === '1';
}

async function writeRuntimeSse(response: ServerResponse, event: StoredThreadEvent): Promise<void> {
  if (!responseCanWrite(response)) return;
  return writeSseFrame(response, 'runtime-event', event);
}

async function writeSweSse(
  response: ServerResponse,
  notifications: SweNotification[],
  capabilities: { experimentalApi?: boolean } = {},
): Promise<void> {
  for (const notification of filterSweNotificationsForClientCapabilities(notifications, capabilities)) {
    if (!responseCanWrite(response)) return;
    await writeSseFrame(response, 'swe-notification', notification);
  }
}

async function writeSseFrame(response: ServerResponse, event: string, value: unknown): Promise<void> {
  if (!responseCanWrite(response)) return;
  if (response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off('drain', handleDrain);
      response.off('close', handleClose);
      response.off('error', handleError);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('Runtime SSE response closed during backpressure.'));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    response.once('drain', handleDrain);
    response.once('close', handleClose);
    response.once('error', handleError);
  });
}

function responseCanWrite(response: ServerResponse): boolean {
  return !response.destroyed && !response.writableEnded && !response.writableFinished;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
