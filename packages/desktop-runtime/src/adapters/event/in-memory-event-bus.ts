import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { EventBus, RuntimeEventSubscriber } from '../../ports/event-bus.js';

export class InMemoryEventBus implements EventBus {
  private subscribers = new Map<string, Set<RuntimeEventSubscriber>>();

  publish(event: RuntimeEvent): void {
    const subscribers = this.subscribers.get(event.threadId);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber(event);
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

