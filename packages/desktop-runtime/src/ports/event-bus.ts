import type { StoredThreadEvent } from '@setsuna-desktop/contracts';

export type RuntimeEventSubscriber = (event: StoredThreadEvent) => void;

export type EventBus = {
  publish(event: StoredThreadEvent): void;
  subscribe(threadId: string, subscriber: RuntimeEventSubscriber): () => void;
};

