import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import { isFeatureEventEnvelope } from '@setsuna-desktop/feature-core/events';
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
    if (!isFeatureEventEnvelope(record)) return;
    const subscriptions = this.subscriptionsByThread.get(record.threadId);
    if (!subscriptions?.size) return;
    for (const subscription of [...subscriptions]) {
      if (record.featureId === subscription.featureId) {
        this.deliver(subscription, record.seq);
      }
    }
  }

  /** A Core resync may have skipped Feature events, so active controllers re-read typed state. */
  resync(threadId: string, throughSeq: number): void {
    const subscriptions = this.subscriptionsByThread.get(threadId);
    if (!subscriptions?.size) return;
    for (const subscription of [...subscriptions]) this.deliver(subscription, throughSeq);
  }

  private deliver(subscription: Subscription, throughSeq: number): void {
    try {
      subscription.listener(throughSeq);
    } catch {
      // One optional controller cannot break the host SSE owner or sibling Features.
      console.error('[renderer-feature] Event feed listener failed.', {
        featureId: subscription.featureId,
        seq: throughSeq,
      });
    }
  }
}
