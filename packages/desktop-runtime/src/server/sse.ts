import type { ServerResponse } from 'node:http';
import type { RuntimeEvent, SweNotification } from '@setsuna-desktop/contracts';
import { createSweNotificationMapper } from '@setsuna-desktop/contracts';
import type { RuntimeFactory } from './types.js';

export async function handleSse({
  format,
  response,
  threadId,
  sinceSeq,
  runtime,
}: {
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

  const sweMapEvent = format === 'swe' ? createSweNotificationMapper() : null;
  const existing = await runtime.threadStore.listEvents(threadId, format === 'swe' ? 0 : sinceSeq);
  for (const event of existing) {
    if (format === 'swe' && sweMapEvent) {
      const notifications = sweMapEvent(event);
      if (event.seq > sinceSeq) writeSweSse(response, notifications);
    } else {
      writeRuntimeSse(response, event);
    }
  }

  const unsubscribe = runtime.eventBus.subscribe(threadId, (event) => {
    if (format === 'swe' && sweMapEvent) {
      writeSweSse(response, sweMapEvent(event));
      return;
    }
    writeRuntimeSse(response, event);
  });
  response.on('close', unsubscribe);
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

function writeRuntimeSse(response: ServerResponse, event: RuntimeEvent): void {
  response.write('event: runtime-event\n');
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSweSse(response: ServerResponse, notifications: SweNotification[]): void {
  for (const notification of notifications) {
    response.write('event: swe-notification\n');
    response.write(`data: ${JSON.stringify(notification)}\n\n`);
  }
}
