import type { RuntimeEvent } from '@setsuna-desktop/contracts';

export type RuntimeEventSubscriber = (event: RuntimeEvent) => void;

export type EventBus = {
  publish(event: RuntimeEvent): void;
  subscribe(threadId: string, subscriber: RuntimeEventSubscriber): () => void;
};

