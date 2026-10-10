import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { EventBus, RuntimeEventSubscriber } from '../../ports/event-bus.js';

export class InMemoryEventBus implements EventBus {
  private subscribers = new Map<string, Set<RuntimeEventSubscriber>>();
  private readonly observers = new Set<RuntimeEventSubscriber>();

  constructor(private readonly observePublication?: RuntimeEventSubscriber) {}

  publish(event: StoredThreadEvent): void {
    try { this.observePublication?.(event); } catch { /* Diagnostics cannot interrupt delivery. */ }
    for (const observer of this.observers) {
      try { observer(event); } catch { /* Optional observers must not fail persistence or SSE delivery. */ }
    }
    const subscribers = this.subscribers.get(event.threadId);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber(event);
  }

  subscribeAll(subscriber: RuntimeEventSubscriber): () => void {
    this.observers.add(subscriber);
    return () => { this.observers.delete(subscriber); };
  }

  subscribe(threadId: string, subscriber: RuntimeEventSubscriber): () => void {
    let subscribers = this.subscribers.get(threadId);
    if (!subscribers) {
      subscribers = new Set();
      this.subscribers.set(threadId, subscribers);
    }
    subscribers.add(subscriber);
    return () => {
      subscribers?.delete(subscriber);
      if (subscribers?.size === 0) this.subscribers.delete(threadId);
    };
  }
}
