import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import { isFeatureEventEnvelope, type FeatureEventFeedItem } from '@setsuna-desktop/feature-core/events';
import type {
  RendererFeatureEventFeed,
  RendererFeatureEventFeedListener,
} from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';

type Subscription = Readonly<{
  featureId: FeatureScope['owner']['featureId'];
  listener: RendererFeatureEventFeedListener;
}>;

/** Dispatches only records accepted by the current thread's global SSE sequence owner. */
export class RendererFeatureEventHub implements RendererFeatureEventFeed {
  private readonly subscriptionsByThread = new Map<string, Set<Subscription>>();

  subscribe(
    scope: FeatureScope,
    threadId: string,
    listener: RendererFeatureEventFeedListener,
  ): Readonly<{ dispose(): void }> {
    if (!threadId.trim()) throw new Error('Feature event feed threadId is required.');
    if (scope.state === 'draining' || scope.state === 'disposed') {
      throw new FeatureScopeUnavailableError('Cannot subscribe after Feature draining has begun.');
    }
    const subscription = Object.freeze({
      featureId: scope.owner.featureId,
      listener,
    });
    const subscriptions = this.subscriptionsByThread.get(threadId) ?? new Set<Subscription>();
    subscriptions.add(subscription);
    this.subscriptionsByThread.set(threadId, subscriptions);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      scope.signal.removeEventListener('abort', dispose);
      subscriptions.delete(subscription);
      if (!subscriptions.size && this.subscriptionsByThread.get(threadId) === subscriptions) {
        this.subscriptionsByThread.delete(threadId);
      }
    };
    // Component subscriptions are shorter-lived than the Feature scope. A
    // removable abort listener preserves scope shutdown without retaining every
    // unmounted controller in the scope's disposer stack.
    scope.signal.addEventListener('abort', dispose, { once: true });
    return Object.freeze({ dispose });
  }

  accept(record: StoredThreadEvent): void {
    const subscriptions = this.subscriptionsByThread.get(record.threadId);
    if (!subscriptions?.size) return;
    for (const subscription of [...subscriptions]) {
      const item: FeatureEventFeedItem = isFeatureEventEnvelope(record)
        && record.featureId === subscription.featureId
        ? Object.freeze({ kind: 'event', seq: record.seq, event: record })
        : Object.freeze({ kind: 'advance', seq: record.seq });
      this.deliver(subscription, item);
    }
  }

  /** A Core resync snapshot has no Feature payload, but its watermark must still reach controllers. */
  advance(threadId: string, throughSeq: number): void {
    const subscriptions = this.subscriptionsByThread.get(threadId);
    if (!subscriptions?.size) return;
    const item: FeatureEventFeedItem = Object.freeze({ kind: 'advance', seq: throughSeq });
    for (const subscription of [...subscriptions]) this.deliver(subscription, item);
  }

  private deliver(subscription: Subscription, item: FeatureEventFeedItem): void {
    try {
      subscription.listener(item);
    } catch {
      // One optional controller cannot break the host SSE owner or sibling Features.
      console.error('[renderer-feature] Event feed listener failed.', {
        featureId: subscription.featureId,
        seq: item.seq,
      });
    }
  }
}
