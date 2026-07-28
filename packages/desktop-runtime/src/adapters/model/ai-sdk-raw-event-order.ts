type SourceEntry<T> =
  | {
      kind: 'sdk';
      events: T[];
    }
  | {
      kind: 'side';
      events: T[];
    };

/**
 * Keeps side-channel events behind every normalized part produced for an
 * earlier SDK raw chunk. The next raw chunk is the boundary that proves those
 * normalized parts have drained; a final side batch is released at stream end.
 */
export class AiSdkRawEventOrder<T> {
  private readonly entries: SourceEntry<T>[] = [];
  private readonly forwardedEntryIndexes: number[] = [];
  private readonly liveQueue = new AsyncEventQueue<T>();
  private nextForwardedEntry = 0;
  private nextUndeliveredEntry = 0;
  private hasForwardedEntry = false;

  record(events: T[], forwardedToAiSdk: boolean): void {
    if (forwardedToAiSdk) {
      const entryIndex = this.entries.length;
      this.entries.push({ kind: 'sdk', events });
      this.forwardedEntryIndexes.push(entryIndex);
      this.hasForwardedEntry = true;
    } else if (events.length) {
      if (this.hasForwardedEntry) {
        this.entries.push({ kind: 'side', events });
      } else {
        for (const event of events) this.liveQueue.push(event);
      }
    }
  }

  recordForwardedWithoutEvents(): void {
    this.record([], true);
  }

  consumeForwardedBatch(): T[] {
    const entryIndex = this.forwardedEntryIndexes[this.nextForwardedEntry++];
    if (entryIndex === undefined) return [];
    const entry = this.entries[entryIndex];
    if (!entry || entry.kind !== 'sdk') return [];
    const events = this.collectSideEventsBefore(entryIndex);
    this.nextUndeliveredEntry = entryIndex + 1;
    events.push(...entry.events);
    return events;
  }

  liveEvents(): AsyncIterable<T> {
    return this.liveQueue;
  }

  finishSource(): void {
    this.liveQueue.close();
  }

  drainRemainingSideEvents(): T[] {
    const events = this.collectSideEventsBefore(this.entries.length);
    this.nextUndeliveredEntry = this.entries.length;
    return events;
  }

  private collectSideEventsBefore(endEntry: number): T[] {
    const events: T[] = [];
    while (this.nextUndeliveredEntry < endEntry) {
      const entry = this.entries[this.nextUndeliveredEntry++];
      if (entry.kind === 'side') events.push(...entry.events);
    }
    return events;
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0, this.waiters.length)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (this.closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
