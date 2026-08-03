import type { RuntimeEvent } from '@setsuna-desktop/contracts';

export type RuntimeSseFaultPlan = {
  chunkSizes?: number[];
  deliveryOrder?: number[];
  dropSequences?: number[];
  duplicateSequences?: number[];
};

/** Builds an SSE response with deterministic transport faults for RuntimeHost tests. */
export function runtimeSseFaultResponse(
  events: RuntimeEvent[],
  plan: RuntimeSseFaultPlan = {},
): Response {
  const eventsBySequence = new Map(events.map((event) => [event.seq, event]));
  const dropSequences = new Set(plan.dropSequences ?? []);
  const duplicateSequences = new Set(plan.duplicateSequences ?? []);
  const deliveryOrder = plan.deliveryOrder ?? events.map((event) => event.seq);
  const payload = deliveryOrder
    .filter((sequence) => !dropSequences.has(sequence))
    .flatMap((sequence) => {
      const event = eventsBySequence.get(sequence);
      if (!event) throw new Error(`Missing runtime event for fault-plan sequence ${sequence}.`);
      const frame = `event: runtime-event\ndata: ${JSON.stringify(event)}\n\n`;
      return duplicateSequences.has(sequence) ? [frame, frame] : [frame];
    })
    .join('');
  const bytes = new TextEncoder().encode(payload);
  const chunks = splitBytes(bytes, plan.chunkSizes ?? []);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function splitBytes(bytes: Uint8Array, chunkSizes: number[]): Uint8Array[] {
  if (!bytes.length) return [];
  if (!chunkSizes.length) return [bytes];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    const requestedSize = chunkSizes[chunkIndex % chunkSizes.length] ?? bytes.length;
    const size = Math.max(1, Math.floor(requestedSize));
    chunks.push(bytes.slice(offset, Math.min(bytes.length, offset + size)));
    offset += size;
    chunkIndex += 1;
  }
  return chunks;
}
