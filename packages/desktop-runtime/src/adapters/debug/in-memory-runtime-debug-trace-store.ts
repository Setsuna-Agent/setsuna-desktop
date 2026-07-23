import type {
  RuntimeDebugTraceEvent,
  RuntimeDebugTraceInput,
  RuntimeDebugTraceList,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { RuntimeDebugTraceStore } from '../../ports/runtime-debug-trace.js';

const MAX_TRACES_PER_THREAD = 10_000;
const MAX_TRACKED_THREADS = 50;

type ThreadTraceBuffer = {
  droppedBeforeSeq?: number;
  nextSeq: number;
  traces: RuntimeDebugTraceEvent[];
};

export class InMemoryRuntimeDebugTraceStore implements RuntimeDebugTraceStore {
  private readonly buffers = new Map<string, ThreadTraceBuffer>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  append(input: RuntimeDebugTraceInput): RuntimeDebugTraceEvent {
    const buffer = this.touchBuffer(input.threadId);
    const trace = {
      ...input,
      createdAt: this.clock.now().toISOString(),
      id: this.ids.id('debug_trace'),
      seq: buffer.nextSeq,
    } as RuntimeDebugTraceEvent;
    buffer.nextSeq += 1;
    buffer.traces.push(trace);
    if (buffer.traces.length > MAX_TRACES_PER_THREAD) {
      const removed = buffer.traces.splice(0, buffer.traces.length - MAX_TRACES_PER_THREAD);
      buffer.droppedBeforeSeq = removed.at(-1)?.seq;
    }
    return trace;
  }

  list(threadId: string, afterSeq = 0): RuntimeDebugTraceList {
    const buffer = this.buffers.get(threadId);
    if (!buffer) return { nextSeq: 1, traces: [] };
    this.touchBuffer(threadId);
    return {
      ...(buffer.droppedBeforeSeq !== undefined ? { droppedBeforeSeq: buffer.droppedBeforeSeq } : {}),
      nextSeq: buffer.nextSeq,
      traces: buffer.traces.filter((trace) => trace.seq > afterSeq),
    };
  }

  private touchBuffer(threadId: string): ThreadTraceBuffer {
    const current = this.buffers.get(threadId);
    if (current) {
      this.buffers.delete(threadId);
      this.buffers.set(threadId, current);
      return current;
    }
    const buffer: ThreadTraceBuffer = { nextSeq: 1, traces: [] };
    this.buffers.set(threadId, buffer);
    while (this.buffers.size > MAX_TRACKED_THREADS) {
      const oldestThreadId = this.buffers.keys().next().value;
      if (typeof oldestThreadId !== 'string') break;
      this.buffers.delete(oldestThreadId);
    }
    return buffer;
  }
}
