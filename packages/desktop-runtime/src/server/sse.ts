import type { ServerResponse } from 'node:http';
import type { RuntimeEvent, SweNotification } from '@setsuna-desktop/contracts';
import { createSweNotificationMapper, filterSweNotificationsForClientCapabilities } from '@setsuna-desktop/contracts';
import type { RuntimeFactory } from './types.js';

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
  const buffered: RuntimeEvent[] = [];
  let replaying = true;
  let closed = false;
  let processedSeq = format === 'swe' ? 0 : sinceSeq;
  const writeEvent = (event: RuntimeEvent) => {
    if (format === 'swe' && sweMapEvent) {
      const notifications = sweMapEvent(event);
      if (event.seq > sinceSeq) writeSweSse(response, notifications, { experimentalApi });
    } else {
      writeRuntimeSse(response, event);
    }
    processedSeq = event.seq;
  };
  const unsubscribe = runtime.eventBus.subscribe(threadId, (event) => {
    if (closed || event.seq <= processedSeq) return;
    if (replaying) buffered.push(event);
    else writeEvent(event);
  });
  response.on('close', () => {
    closed = true;
    unsubscribe();
  });

  try {
    // 重放前先订阅。读取日志期间发布的事件会被缓冲，并在重放到达实时边界时按 seq 去重。
    const existing = await runtime.threadStore.listEvents(threadId, format === 'swe' ? 0 : sinceSeq);
    if (closed) return;
    for (const event of existing) {
      if (event.seq <= processedSeq) continue;
      writeEvent(event);
    }
    for (const event of buffered.sort((left, right) => left.seq - right.seq)) {
      if (event.seq <= processedSeq) continue;
      writeEvent(event);
    }
    replaying = false;
  } catch (error) {
    unsubscribe();
    response.destroy(error instanceof Error ? error : new Error(String(error)));
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
    writeSweSse(response, [notification], { experimentalApi });
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

function writeRuntimeSse(response: ServerResponse, event: RuntimeEvent): void {
  response.write('event: runtime-event\n');
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSweSse(
  response: ServerResponse,
  notifications: SweNotification[],
  capabilities: { experimentalApi?: boolean } = {},
): void {
  for (const notification of filterSweNotificationsForClientCapabilities(notifications, capabilities)) {
    response.write('event: swe-notification\n');
    response.write(`data: ${JSON.stringify(notification)}\n\n`);
  }
}
