import type { DependencySpec, ResolveDependencies } from '../capability.js';
import type { FeatureId } from '../definition.js';
import type { Awaitable, Disposer } from '../scope.js';
import type { FeatureComposition } from './composition.js';

type FeatureHostBinding<TSpec extends DependencySpec> = (
  dependencies: ResolveDependencies<TSpec>
) => Disposer;

export type FeatureHostBindingContext<TActivation> = Readonly<{
  composition: FeatureComposition<TActivation>;
  add(disposer: Disposer): void;
  bind<const TSpec extends DependencySpec>(
    spec: TSpec,
    attach: FeatureHostBinding<TSpec>,
    ...additionalAttachments: readonly FeatureHostBinding<TSpec>[]
  ): void;
  bindWhenFeatureAvailable<const TSpec extends DependencySpec>(
    featureId: FeatureId,
    spec: TSpec,
    attach: FeatureHostBinding<TSpec>,
    ...additionalAttachments: readonly FeatureHostBinding<TSpec>[]
  ): void;
}>;

/**
 * Completes process-host wiring after Feature setup has succeeded.
 *
 * Host bindings live outside individual Feature scopes, so they must be
 * released before the composition starts draining its scopes. Keeping this
 * transaction in the composition kernel prevents each process root from
 * reimplementing partial-activation rollback.
 */
export async function completeFeatureHostActivation<TActivation, TResult>(
  composition: FeatureComposition<TActivation>,
  complete: (context: FeatureHostBindingContext<TActivation>) => Awaitable<TResult>,
): Promise<TResult> {
  const bindings: Disposer[] = [];
  let acceptingBindings = true;
  let disposePromise: Promise<void> | null = null;

  const managedComposition: FeatureComposition<TActivation> = Object.freeze({
    ...composition,
    dispose: () => {
      disposePromise ??= disposeFeatureHostBindings(composition, bindings);
      return disposePromise;
    },
  });
  const add = (disposer: Disposer): void => {
    if (!acceptingBindings) {
      throw new Error('Feature host activation has already completed.');
    }
    bindings.push(disposer);
  };
  const bind = <const TSpec extends DependencySpec>(
    spec: TSpec,
    attach: FeatureHostBinding<TSpec>,
    ...additionalAttachments: readonly FeatureHostBinding<TSpec>[]
  ): void => {
    const dependencies = composition.resolveHostDependencies(spec);
    for (const attachBinding of [attach, ...additionalAttachments]) {
      // Register each successful attachment immediately so a later failure
      // still rolls back the bindings that were already established.
      add(attachBinding(dependencies));
    }
  };
  const context: FeatureHostBindingContext<TActivation> = Object.freeze({
    composition: managedComposition,
    add,
    bind,
    bindWhenFeatureAvailable: <const TSpec extends DependencySpec>(
      featureId: FeatureId,
      spec: TSpec,
      attach: FeatureHostBinding<TSpec>,
      ...additionalAttachments: readonly FeatureHostBinding<TSpec>[]
    ): void => {
      const status = composition.status(featureId)?.status;
      if (status === 'active' || status === 'degraded') {
        bind(spec, attach, ...additionalAttachments);
      }
    },
  });

  try {
    const result = await complete(context);
    acceptingBindings = false;
    return result;
  } catch (error) {
    acceptingBindings = false;
    try {
      await managedComposition.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Feature host activation failed and could not be rolled back cleanly.',
      );
    }
    throw error;
  }
}

async function disposeFeatureHostBindings<TActivation>(
  composition: FeatureComposition<TActivation>,
  bindings: readonly Disposer[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const dispose of [...bindings].reverse()) {
    try {
      await dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await composition.dispose();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    throw new AggregateError(errors, 'Feature host failed to dispose cleanly.');
  }
}
