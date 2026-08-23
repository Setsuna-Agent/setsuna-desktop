import type { FeatureId } from './definition.js';
import {
  FeatureOperationCancelledError,
  FeatureScopeUnavailableError,
} from './status.js';

export type Awaitable<T> = T | PromiseLike<T>;
export type Disposer = () => Awaitable<void>;

export type FeatureOwner = Readonly<{
  featureId: FeatureId;
  scopeId: string;
  process: 'runtime' | 'renderer' | 'main';
}>;

export type FeatureScopeState = 'setting-up' | 'active' | 'draining' | 'disposed';

export interface FeatureScope {
  readonly owner: FeatureOwner;
  readonly signal: AbortSignal;
  readonly state: FeatureScopeState;
  add(disposer: Disposer): void;
  track<T>(resource: T, dispose: (resource: T) => Awaitable<void>): T;
  runOperation<T>(
    operation: (signal: AbortSignal) => Awaitable<T>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<T>;
  dispose(): Promise<void>;
}

export interface FeatureScopeController {
  readonly scope: FeatureScope;
  activate(): void;
  beginDrain(): void;
  finishDispose(): Promise<void>;
}

class ManagedFeatureScope implements FeatureScope, FeatureScopeController {
  readonly owner: FeatureOwner;
  readonly signal: AbortSignal;
  readonly scope = this;

  private readonly abortController = new AbortController();
  private readonly disposers: Disposer[] = [];
  private currentState: FeatureScopeState = 'setting-up';
  private inFlight = 0;
  private idleResolvers: Array<() => void> = [];
  private disposePromise: Promise<void> | null = null;

  constructor(owner: FeatureOwner) {
    this.owner = Object.freeze({ ...owner });
    this.signal = this.abortController.signal;
  }

  get state(): FeatureScopeState {
    return this.currentState;
  }

  add(disposer: Disposer): void {
    if (this.currentState === 'draining' || this.currentState === 'disposed') {
      throw new FeatureScopeUnavailableError('Cannot register an effect after Feature draining has begun.');
    }
    this.disposers.push(disposer);
  }

  track<T>(resource: T, dispose: (resource: T) => Awaitable<void>): T {
    this.add(() => dispose(resource));
    return resource;
  }

  activate(): void {
    if (this.currentState !== 'setting-up') {
      throw new Error(`Cannot activate Feature scope from state "${this.currentState}".`);
    }
    this.currentState = 'active';
  }

  async runOperation<T>(
    operation: (signal: AbortSignal) => Awaitable<T>,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<T> {
    if (this.currentState !== 'active') {
      throw new FeatureScopeUnavailableError();
    }
    if (options.signal?.aborted) {
      throw new FeatureOperationCancelledError();
    }

    this.inFlight += 1;
    const combined = combineAbortSignals(this.signal, options.signal);
    try {
      return await operation(combined.signal);
    } finally {
      combined.dispose();
      this.inFlight -= 1;
      if (this.inFlight === 0) {
        const resolvers = this.idleResolvers;
        this.idleResolvers = [];
        for (const resolve of resolvers) resolve();
      }
    }
  }

  beginDrain(): void {
    if (this.currentState === 'disposed' || this.currentState === 'draining') return;
    this.currentState = 'draining';
    this.abortController.abort(new FeatureOperationCancelledError('Feature scope is draining.'));
  }

  dispose(): Promise<void> {
    return this.finishDispose();
  }

  finishDispose(): Promise<void> {
    this.beginDrain();
    this.disposePromise ??= this.disposeEffects();
    return this.disposePromise;
  }

  private async disposeEffects(): Promise<void> {
    if (this.inFlight > 0) {
      await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
    }

    const errors: unknown[] = [];
    for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
      try {
        await this.disposers[index]();
      } catch (error) {
        errors.push(error);
      }
    }
    this.disposers.length = 0;
    this.currentState = 'disposed';
    if (errors.length) {
      throw new AggregateError(errors, `Feature scope "${this.owner.scopeId}" failed to dispose cleanly.`);
    }
  }
}

export function createFeatureScope(owner: FeatureOwner): FeatureScopeController {
  return new ManagedFeatureScope(owner);
}

function combineAbortSignals(
  scopeSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
): Readonly<{ signal: AbortSignal; dispose(): void }> {
  if (!callerSignal) {
    return Object.freeze({ signal: scopeSignal, dispose: () => undefined });
  }

  const controller = new AbortController();
  const abortFromScope = () => controller.abort(scopeSignal.reason);
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (scopeSignal.aborted) abortFromScope();
  else scopeSignal.addEventListener('abort', abortFromScope, { once: true });
  if (callerSignal.aborted) abortFromCaller();
  else callerSignal.addEventListener('abort', abortFromCaller, { once: true });

  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      scopeSignal.removeEventListener('abort', abortFromScope);
      callerSignal.removeEventListener('abort', abortFromCaller);
    },
  });
}
