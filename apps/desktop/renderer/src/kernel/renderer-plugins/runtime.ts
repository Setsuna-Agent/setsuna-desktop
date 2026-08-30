import type {
  RendererAnySlot,
  RendererChainSlot,
  RendererChainSlotEntry,
  RendererKeyedEntryDescriptor,
  RendererKeyedSlot,
  RendererKeyedSlotEntry,
  RendererListSlot,
  RendererListSlotEntry,
  RendererPluginOwner,
  RendererPluginDefinition,
  RendererSingleSlot,
  RendererSingleSlotEntry,
  RendererSlotDeclaration,
  RendererUiRegistrar,
  RendererVisualSlot,
} from '@setsuna-desktop/feature-core/renderer';
import {
  assertRendererPluginId,
  assertRendererSlotEntryId,
} from '@setsuna-desktop/feature-core/renderer';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';
import {
  decodeRendererLayoutPreferences,
  emptyRendererLayoutPreferences,
  type RendererLayoutPreferencesV1,
} from './layout-preferences.js';
import {
  activeRegistrations,
  comparePriority,
  inspectRendererSnapshot,
  isChainRegistration,
  isVisualRegistration,
  resolveVisualEntry,
  selectKeyedRegistration,
  selectListRegistrations,
  selectSingleRegistration,
} from './selection.js';
import {
  RendererSlotValidationError,
  validateRendererPluginSnapshot,
} from './validation.js';
import type {
  RendererSlotInspection,
  RendererSlotRenderErrorInspection,
} from './selection.js';

export type {
  RendererSlotCandidateState,
  RendererSlotInspection,
  RendererSlotInspectionCandidate,
  RendererSlotInspectionNode,
  RendererSlotRenderErrorInspection,
  RendererStaleLayoutPreference,
} from './selection.js';

export type RendererPluginRuntimeState = 'collecting' | 'ready' | 'disposing' | 'disposed';

export { RendererSlotValidationError } from './validation.js';

export type ErasedDeclaration = Readonly<{
  fallback?: unknown;
  owner: RendererPluginOwner;
  required: boolean;
  requiredKeys: readonly string[];
  slot: RendererAnySlot;
}>;

export type ErasedVisualRegistration = Readonly<{
  children: readonly ErasedDeclaration[];
  entryId: string;
  errorFallback?: (error: Error, props: any, reset: () => void) => unknown;
  key?: string;
  metadata?: unknown;
  mountEpoch: number;
  order?: number;
  owner: RendererPluginOwner;
  priority: number;
  registrationKey: string;
  render: (props: any, slots: any) => unknown;
  slot: RendererVisualSlot<any>;
  when?: (props: any) => boolean;
}>;

type ErasedChainRegistration = Readonly<{
  entryId: string;
  mountEpoch: number;
  owner: RendererPluginOwner;
  priority: number;
  registrationKey: string;
  select(input: unknown): unknown | null;
  slot: RendererChainSlot<any, any>;
}>;

export type ErasedRegistration = ErasedVisualRegistration | ErasedChainRegistration;

export type ResolvedRendererVisualEntry<TProps extends object = any, TMetadata = unknown> = Readonly<{
  children: readonly ErasedDeclaration[];
  entryId: string;
  errorFallback?: (error: Error, props: TProps, reset: () => void) => unknown;
  mountEpoch: number;
  metadata?: TMetadata;
  owner: RendererPluginOwner;
  registrationKey: string;
  render: (props: TProps, slots: any) => unknown;
  slotId: string;
  key?: string;
  when?: (props: TProps) => boolean;
}>;

export type ResolvedRendererVisualSlot<TProps extends object> = Readonly<{
  declaration: ErasedDeclaration;
  entries: readonly ResolvedRendererVisualEntry<TProps>[];
}>;

export interface RendererPluginRuntime {
  readonly state: RendererPluginRuntimeState;
  clearRenderError(registrationKey: string): void;
  commitInitial(): RendererPluginSnapshot;
  createRegistrar(
    owner: RendererPluginOwner,
    track?: (disposer: Disposer) => void,
  ): RendererUiRegistrar;
  declareRoot<TSlot extends RendererAnySlot>(
    owner: RendererPluginOwner,
    declaration: RendererSlotDeclaration<TSlot>,
  ): Disposer;
  dispose(): Promise<void>;
  getPreferences(): RendererLayoutPreferencesV1;
  getSnapshot(): RendererPluginSnapshot;
  mount(plugin: RendererPluginDefinition): Promise<Disposer>;
  reportRenderError(entry: ResolvedRendererVisualEntry, error: Error): void;
  subscribe(listener: () => void): () => void;
  updatePreferences(preferences: RendererLayoutPreferencesV1): Promise<RendererPluginSnapshot>;
}

export type RendererPluginRuntimeOptions = Readonly<{
  initialPreferences?: RendererLayoutPreferencesV1;
}>;

export class RendererPluginSnapshot {
  readonly version: number;

  private readonly roots: ReadonlyMap<string, ErasedDeclaration>;
  private readonly bySlot: ReadonlyMap<string, readonly ErasedRegistration[]>;
  private readonly registrationsByKey: ReadonlyMap<string, ErasedRegistration>;
  private readonly preferences: RendererLayoutPreferencesV1;
  private readonly renderErrors: ReadonlyMap<string, RendererSlotRenderErrorInspection>;

  constructor(
    version: number,
    roots: ReadonlyMap<string, ErasedDeclaration>,
    registrations: readonly ErasedRegistration[],
    preferences: RendererLayoutPreferencesV1 = emptyRendererLayoutPreferences(),
    renderErrors: ReadonlyMap<string, RendererSlotRenderErrorInspection> = new Map(),
    knownChildSlotIds: ReadonlySet<string> = new Set(),
  ) {
    this.version = version;
    this.roots = new Map(roots);
    this.preferences = preferences;
    this.renderErrors = new Map(renderErrors);
    this.registrationsByKey = new Map(
      registrations.map((registration) => [registration.registrationKey, registration]),
    );
    const bySlot = new Map<string, ErasedRegistration[]>();
    for (const registration of registrations) {
      const entries = bySlot.get(registration.slot.id) ?? [];
      entries.push(registration);
      bySlot.set(registration.slot.id, entries);
    }
    this.bySlot = new Map(
      [...bySlot].map(([slotId, entries]) => [slotId, Object.freeze([...entries])]),
    );
    validateRendererPluginSnapshot(this.roots, this.bySlot, knownChildSlotIds);
    Object.freeze(this);
  }

  resolveSingle<TProps extends object>(
    slot: RendererSingleSlot<TProps>,
    parent?: ResolvedRendererVisualEntry,
  ): ResolvedRendererVisualSlot<TProps> {
    const declaration = this.requireDeclaration(slot, parent);
    const entries = selectSingleRegistration(slot, this.visualEntries(slot), this.preferences)
      .map(resolveVisualEntry<TProps>);
    return Object.freeze({ declaration, entries: Object.freeze(entries) });
  }

  resolveList<TProps extends object>(
    slot: RendererListSlot<TProps>,
    parent?: ResolvedRendererVisualEntry,
  ): ResolvedRendererVisualSlot<TProps> {
    const declaration = this.requireDeclaration(slot, parent);
    const entries = selectListRegistrations(slot, this.visualEntries(slot), this.preferences)
      .map(resolveVisualEntry<TProps>);
    return Object.freeze({ declaration, entries: Object.freeze(entries) });
  }

  resolveKeyed<TKey extends string, TProps extends object, TMetadata>(
    slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
    key: TKey,
    parent?: ResolvedRendererVisualEntry,
  ): ResolvedRendererVisualSlot<TProps> {
    const declaration = this.requireDeclaration(slot, parent);
    const entries = selectKeyedRegistration(slot, key, this.visualEntries(slot), this.preferences)
      .map(resolveVisualEntry<TProps>);
    return Object.freeze({ declaration, entries: Object.freeze(entries) });
  }

  resolveKeyedEntries<TKey extends string, TProps extends object, TMetadata>(
    slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
    parent?: ResolvedRendererVisualEntry,
  ): readonly RendererKeyedEntryDescriptor<TKey, TMetadata>[] {
    this.requireDeclaration(slot, parent);
    const active = activeRegistrations(slot, this.visualEntries(slot), this.preferences);
    return Object.freeze(active.filter(isVisualRegistration).map((entry) => Object.freeze({
      entryId: entry.entryId,
      key: entry.key as TKey,
      metadata: entry.metadata as TMetadata,
      owner: entry.owner,
    })));
  }

  resolveChain<TInput, TOutput>(
    slot: RendererChainSlot<TInput, TOutput>,
    input: TInput,
    parent?: ResolvedRendererVisualEntry,
  ): TOutput {
    const declaration = this.requireDeclaration(slot, parent);
    const entries = this.chainEntries(slot).sort(comparePriority);
    for (const entry of entries) {
      const selected = entry.select(input);
      if (selected !== null) return selected as TOutput;
    }
    const fallback = declaration.fallback as { resolve(value: TInput): TOutput } | undefined;
    if (fallback) return fallback.resolve(input);
    throw new RendererSlotValidationError([
      `Chain Slot "${slot.id}" did not resolve a value and has no fallback.`,
    ]);
  }

  inspect(): RendererSlotInspection {
    return inspectRendererSnapshot({
      bySlot: this.bySlot,
      preferences: this.preferences,
      registrationsByKey: this.registrationsByKey,
      renderErrors: this.renderErrors,
      roots: this.roots,
      snapshotVersion: this.version,
    });
  }

  private requireDeclaration(
    slot: RendererAnySlot,
    parent: ResolvedRendererVisualEntry | undefined,
  ): ErasedDeclaration {
    if (!parent) {
      const root = this.roots.get(slot.id);
      if (!root) throw new Error(`Renderer Slot "${slot.id}" is not declared as a root.`);
      return root;
    }
    if (!this.registrationsByKey.has(parent.registrationKey)) {
      throw new Error(`Renderer Slot parent "${parent.entryId}" does not belong to this snapshot.`);
    }
    const declaration = parent.children.find((candidate) => candidate.slot.id === slot.id);
    if (!declaration) {
      throw new Error(`Renderer Slot entry "${parent.entryId}" does not own child "${slot.id}".`);
    }
    return declaration;
  }

  private visualEntries(slot: RendererVisualSlot<any>): ErasedVisualRegistration[] {
    return (this.bySlot.get(slot.id) ?? []).filter(isVisualRegistration);
  }

  private chainEntries(slot: RendererChainSlot<any, any>): ErasedChainRegistration[] {
    return (this.bySlot.get(slot.id) ?? []).filter(isChainRegistration);
  }
}

export function createRendererPluginRuntime(
  options: RendererPluginRuntimeOptions = {},
): RendererPluginRuntime {
  let state: RendererPluginRuntimeState = 'collecting';
  let nextEpoch = 1;
  let nextVersion = 1;
  let preferences = decodeRendererLayoutPreferences(
    options.initialPreferences ?? emptyRendererLayoutPreferences(),
  );
  let snapshot = new RendererPluginSnapshot(0, new Map(), [], preferences);
  let mutationQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const definitions = new Map<string, RendererAnySlot>();
  const roots = new Map<string, ErasedDeclaration>();
  const registrations = new Map<string, ErasedRegistration>();
  const renderErrors = new Map<string, RendererSlotRenderErrorInspection>();
  const dynamicMounts = new Map<string, Readonly<{ registrationKeys: ReadonlySet<string> }>>();
  // A dependent Plugin may outlive the parent that declared its Slot. Retain
  // committed child identities so those registrations become dormant instead
  // of making the parent unmount transaction invalid.
  const knownChildSlotIds = new Set<string>();

  const publish = (nextSnapshot: RendererPluginSnapshot) => {
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  };
  const ensureDefinitionIn = (
    target: Map<string, RendererAnySlot>,
    slot: RendererAnySlot,
  ) => {
    const existing = target.get(slot.id);
    if (existing && (
      existing.kind !== slot.kind
      || existing.scope !== slot.scope
      || existing.userConfigurable !== slot.userConfigurable
    )) {
      throw new RendererSlotValidationError([
        `Slot "${slot.id}" is defined with conflicting kind, scope, or configurability.`,
      ]);
    }
    if (!existing) target.set(slot.id, slot);
  };
  const ensureDefinition = (slot: RendererAnySlot) => ensureDefinitionIn(definitions, slot);
  const assertMutable = () => {
    if (state === 'disposing' || state === 'disposed') {
      throw new Error('Renderer Plugin Runtime is disposing and no longer accepts registrations.');
    }
  };
  const assertCollectingRegistration = () => {
    assertMutable();
    if (state !== 'collecting') {
      throw new Error('Use runtime.mount() for Plugin changes after the initial snapshot is committed.');
    }
  };
  const enqueueMutation = <TValue>(operation: () => Promise<TValue> | TValue): Promise<TValue> => {
    const result = mutationQueue.then(async () => {
      if (state !== 'ready') {
        throw new Error('Renderer Plugin Runtime is not ready for transactional mutations.');
      }
      const value = await operation();
      if (state !== 'ready') {
        throw new Error('Renderer Plugin Runtime stopped before the transaction committed.');
      }
      return value;
    });
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const commitReadySnapshot = (
    stagedRegistrations: ReadonlyMap<string, ErasedRegistration>,
    stagedPreferences: RendererLayoutPreferencesV1,
    stagedDefinitions: ReadonlyMap<string, RendererAnySlot> = definitions,
  ): RendererPluginSnapshot => {
    if (state !== 'ready') {
      throw new Error('Renderer Plugin Runtime stopped before the transaction committed.');
    }
    const nextKnownChildSlotIds = collectKnownChildSlotIds(
      stagedRegistrations,
      knownChildSlotIds,
    );
    const nextSnapshot = buildSnapshot(
      nextVersion,
      roots,
      stagedRegistrations,
      stagedPreferences,
      new Map(),
      nextKnownChildSlotIds,
    );
    replaceMap(registrations, stagedRegistrations);
    replaceMap(definitions, stagedDefinitions);
    replaceSet(knownChildSlotIds, nextKnownChildSlotIds);
    preferences = stagedPreferences;
    renderErrors.clear();
    nextVersion += 1;
    publish(nextSnapshot);
    return nextSnapshot;
  };
  const removeRegistration = (registration: ErasedRegistration): Disposer => {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (state === 'disposing' || state === 'disposed') {
        registrations.delete(registration.registrationKey);
        return;
      }
      const current = registrations.get(registration.registrationKey);
      if (current !== registration) return;
      if (state === 'ready') {
        return enqueueMutation(() => {
          const staged = new Map(registrations);
          if (staged.get(registration.registrationKey) !== registration) return;
          staged.delete(registration.registrationKey);
          commitReadySnapshot(staged, preferences);
        });
      }
      registrations.delete(registration.registrationKey);
    };
  };
  const register = (
    owner: RendererPluginOwner,
    slot: RendererAnySlot,
    rawEntry: Record<string, unknown>,
  ): Disposer => {
    assertCollectingRegistration();
    ensureDefinition(slot);
    const entryId = String(rawEntry.id ?? '');
    assertRendererSlotEntryId(entryId);
    const duplicate = [...registrations.values()].find(
      (candidate) => candidate.slot.id === slot.id && candidate.entryId === entryId,
    );
    if (duplicate) {
      throw new RendererSlotValidationError([
        `Slot "${slot.id}" entry "${entryId}" is registered by both "${duplicate.owner.pluginId}" and "${owner.pluginId}".`,
      ]);
    }
    const mountEpoch = nextEpoch;
    nextEpoch += 1;
    const registrationKey = `${slot.id}\u0000${entryId}\u0000${mountEpoch}`;
    const registration = createRegistration(
      owner,
      slot,
      rawEntry,
      entryId,
      mountEpoch,
      registrationKey,
      ensureDefinition,
    );
    registrations.set(registrationKey, registration);
    return removeRegistration(registration);
  };
  const createRegistrar = (
    owner: RendererPluginOwner,
    track?: (disposer: Disposer) => void,
  ): RendererUiRegistrar => {
    assertRendererPluginId(owner.pluginId);
    if (!owner.scopeId.trim()) throw new Error('Renderer Plugin owner scopeId is required.');
    const tracked = (disposer: Disposer): Disposer => {
      try {
        track?.(disposer);
        return disposer;
      } catch (error) {
        void disposer();
        throw error;
      }
    };
    const registrar: RendererUiRegistrar = {
      owner,
      single: <TProps extends object>(
        slot: RendererSingleSlot<TProps>,
        entry: RendererSingleSlotEntry<TProps>,
      ) => tracked(register(owner, slot, entry as unknown as Record<string, unknown>)),
      list: <TProps extends object>(
        slot: RendererListSlot<TProps>,
        entry: RendererListSlotEntry<TProps>,
      ) => tracked(register(owner, slot, entry as unknown as Record<string, unknown>)),
      keyed: <TKey extends string, TProps extends object, TMetadata>(
        slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
        entry: RendererKeyedSlotEntry<TKey, TProps, TMetadata>,
      ) => tracked(register(owner, slot, entry as unknown as Record<string, unknown>)),
      chain: <TInput, TOutput>(
        slot: RendererChainSlot<TInput, TOutput>,
        entry: RendererChainSlotEntry<TInput, TOutput>,
      ) => tracked(register(owner, slot, entry as unknown as Record<string, unknown>)),
    };
    return Object.freeze(registrar);
  };

  const runtime: RendererPluginRuntime = {
    get state() {
      return state;
    },
    clearRenderError: (registrationKey: string) => {
      if (!renderErrors.delete(registrationKey) || state !== 'ready') return;
      publish(buildSnapshot(
        snapshot.version,
        roots,
        registrations,
        preferences,
        renderErrors,
        knownChildSlotIds,
      ));
    },
    commitInitial: () => {
      if (state !== 'collecting') throw new Error('Renderer Plugin Runtime initial snapshot is already committed.');
      const initialKnownChildSlotIds = collectKnownChildSlotIds(registrations);
      const initial = buildSnapshot(
        nextVersion,
        roots,
        registrations,
        preferences,
        new Map(),
        initialKnownChildSlotIds,
      );
      replaceSet(knownChildSlotIds, initialKnownChildSlotIds);
      nextVersion += 1;
      state = 'ready';
      publish(initial);
      return initial;
    },
    createRegistrar,
    declareRoot: <TSlot extends RendererAnySlot>(
      owner: RendererPluginOwner,
      declaration: RendererSlotDeclaration<TSlot>,
    ) => {
      assertCollectingRegistration();
      assertRendererPluginId(owner.pluginId);
      ensureDefinition(declaration.slot);
      if (roots.has(declaration.slot.id)) {
        throw new RendererSlotValidationError([
          `Renderer root Slot "${declaration.slot.id}" is declared more than once.`,
        ]);
      }
      const erased = eraseDeclaration(owner, declaration, ensureDefinition);
      roots.set(declaration.slot.id, erased);
      let active = true;
      return () => {
        if (!active) return;
        if (state === 'ready') {
          throw new Error('Renderer root Slot declarations cannot be removed after initial commit.');
        }
        active = false;
        if (roots.get(declaration.slot.id) !== erased) return;
        roots.delete(declaration.slot.id);
      };
    },
    dispose: async () => {
      if (state === 'disposed') return;
      state = 'disposing';
      await mutationQueue;
      roots.clear();
      registrations.clear();
      dynamicMounts.clear();
      definitions.clear();
      renderErrors.clear();
      knownChildSlotIds.clear();
      state = 'disposed';
      preferences = emptyRendererLayoutPreferences();
      publish(new RendererPluginSnapshot(nextVersion, new Map(), [], preferences));
      nextVersion += 1;
      listeners.clear();
    },
    getPreferences: () => preferences,
    getSnapshot: () => snapshot,
    mount: (plugin: RendererPluginDefinition) => {
      assertRendererPluginId(plugin.id);
      return enqueueMutation(async () => {
        const stagedRegistrations = new Map(registrations);
        const stagedDefinitions = new Map(definitions);
        const previousMount = dynamicMounts.get(plugin.id);
        for (const registrationKey of previousMount?.registrationKeys ?? []) {
          stagedRegistrations.delete(registrationKey);
        }
        const addedKeys = new Set<string>();
        let registrationsCommitted = false;
        let stagedNextEpoch = nextEpoch;
        const owner = Object.freeze({
          pluginId: plugin.id,
          scopeId: `dynamic:${plugin.id}:${stagedNextEpoch}`,
        });
        const stageRegister = (
          slot: RendererAnySlot,
          rawEntry: Record<string, unknown>,
        ): Disposer => {
          ensureDefinitionIn(stagedDefinitions, slot);
          const entryId = String(rawEntry.id ?? '');
          assertRendererSlotEntryId(entryId);
          const duplicate = [...stagedRegistrations.values()].find(
            (candidate) => candidate.slot.id === slot.id && candidate.entryId === entryId,
          );
          if (duplicate) {
            throw new RendererSlotValidationError([
              `Slot "${slot.id}" entry "${entryId}" is registered by both "${duplicate.owner.pluginId}" and "${owner.pluginId}".`,
            ]);
          }
          const mountEpoch = stagedNextEpoch;
          stagedNextEpoch += 1;
          const registrationKey = `${slot.id}\u0000${entryId}\u0000${mountEpoch}`;
          const registration = createRegistration(
            owner,
            slot,
            rawEntry,
            entryId,
            mountEpoch,
            registrationKey,
            (childSlot) => ensureDefinitionIn(stagedDefinitions, childSlot),
          );
          stagedRegistrations.set(registrationKey, registration);
          addedKeys.add(registrationKey);
          const removeCommittedRegistration = removeRegistration(registration);
          return () => {
            if (registrationsCommitted) return removeCommittedRegistration();
            if (stagedRegistrations.get(registrationKey) !== registration) return;
            stagedRegistrations.delete(registrationKey);
            addedKeys.delete(registrationKey);
          };
        };
        const ui = createRuntimeRegistrar(owner, stageRegister);
        await plugin.activate(Object.freeze({ ui }));
        registrationsCommitted = true;
        try {
          commitReadySnapshot(stagedRegistrations, preferences, stagedDefinitions);
        } catch (error) {
          registrationsCommitted = false;
          throw error;
        }
        nextEpoch = stagedNextEpoch;
        const activeMount = Object.freeze({ registrationKeys: new Set(addedKeys) });
        dynamicMounts.set(plugin.id, activeMount);

        let mounted = true;
        return () => {
          if (!mounted || state === 'disposing' || state === 'disposed') return;
          return enqueueMutation(() => {
            if (!mounted || dynamicMounts.get(plugin.id) !== activeMount) {
              mounted = false;
              return;
            }
            const nextRegistrations = new Map(registrations);
            for (const registrationKey of addedKeys) nextRegistrations.delete(registrationKey);
            commitReadySnapshot(nextRegistrations, preferences);
            dynamicMounts.delete(plugin.id);
            mounted = false;
          });
        };
      });
    },
    reportRenderError: (entry: ResolvedRendererVisualEntry, error: Error) => {
      if (state !== 'ready' || !registrations.has(entry.registrationKey)) return;
      renderErrors.set(entry.registrationKey, Object.freeze({
        entryId: entry.entryId,
        errorName: error.name,
        owner: entry.owner,
        reportedAt: new Date().toISOString(),
        slotId: entry.slotId,
      }));
      publish(buildSnapshot(
        snapshot.version,
        roots,
        registrations,
        preferences,
        renderErrors,
        knownChildSlotIds,
      ));
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updatePreferences: (input: RendererLayoutPreferencesV1) => {
      let normalized: RendererLayoutPreferencesV1;
      try {
        normalized = decodeRendererLayoutPreferences(input);
      } catch (error) {
        return Promise.reject(error);
      }
      return enqueueMutation(() => commitReadySnapshot(registrations, normalized));
    },
  };
  return Object.freeze(runtime);
}

function createRuntimeRegistrar(
  owner: RendererPluginOwner,
  register: (slot: RendererAnySlot, entry: Record<string, unknown>) => Disposer,
): RendererUiRegistrar {
  return Object.freeze({
    owner,
    single: <TProps extends object>(
      slot: RendererSingleSlot<TProps>,
      entry: RendererSingleSlotEntry<TProps>,
    ) => register(slot, entry as unknown as Record<string, unknown>),
    list: <TProps extends object>(
      slot: RendererListSlot<TProps>,
      entry: RendererListSlotEntry<TProps>,
    ) => register(slot, entry as unknown as Record<string, unknown>),
    keyed: <TKey extends string, TProps extends object, TMetadata>(
      slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
      entry: RendererKeyedSlotEntry<TKey, TProps, TMetadata>,
    ) => register(slot, entry as unknown as Record<string, unknown>),
    chain: <TInput, TOutput>(
      slot: RendererChainSlot<TInput, TOutput>,
      entry: RendererChainSlotEntry<TInput, TOutput>,
    ) => register(slot, entry as unknown as Record<string, unknown>),
  });
}

function replaceMap<TKey, TValue>(
  target: Map<TKey, TValue>,
  source: ReadonlyMap<TKey, TValue>,
): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

function replaceSet<TValue>(target: Set<TValue>, source: ReadonlySet<TValue>): void {
  target.clear();
  for (const value of source) target.add(value);
}

function createRegistration(
  owner: RendererPluginOwner,
  slot: RendererAnySlot,
  rawEntry: Record<string, unknown>,
  entryId: string,
  mountEpoch: number,
  registrationKey: string,
  ensureDefinition: (slot: RendererAnySlot) => void,
): ErasedRegistration {
  const priority = finiteNumber(rawEntry.priority ?? 0, `${slot.id}/${entryId} priority`);
  if (slot.kind === 'chain') {
    if (typeof rawEntry.select !== 'function') {
      throw new RendererSlotValidationError([`Chain entry "${entryId}" must provide select().`]);
    }
    return Object.freeze({
      entryId,
      mountEpoch,
      owner,
      priority,
      registrationKey,
      select: rawEntry.select as (input: unknown) => unknown | null,
      slot,
    });
  }
  if (typeof rawEntry.render !== 'function') {
    throw new RendererSlotValidationError([`Visual entry "${entryId}" must provide render().`]);
  }
  const children = eraseChildDeclarations(
    owner,
    rawEntry.children as readonly RendererSlotDeclaration[] | undefined,
    ensureDefinition,
  );
  const base = {
    children,
    entryId,
    errorFallback: typeof rawEntry.errorFallback === 'function'
      ? rawEntry.errorFallback as (error: Error, props: any, reset: () => void) => unknown
      : undefined,
    mountEpoch,
    owner,
    priority,
    registrationKey,
    render: rawEntry.render as (props: any, slots: any) => unknown,
    slot,
  };
  if (slot.kind === 'list') {
    return Object.freeze({
      ...base,
      order: finiteNumber(rawEntry.order, `${slot.id}/${entryId} order`),
      when: typeof rawEntry.when === 'function' ? rawEntry.when as (props: any) => boolean : undefined,
    });
  }
  if (slot.kind === 'keyed') {
    if (typeof rawEntry.key !== 'string' || !rawEntry.key.trim()) {
      throw new RendererSlotValidationError([`Keyed entry "${entryId}" must provide a non-empty key.`]);
    }
    return Object.freeze({
      ...base,
      key: rawEntry.key,
      metadata: rawEntry.metadata,
    });
  }
  return Object.freeze(base);
}

function eraseChildDeclarations(
  owner: RendererPluginOwner,
  declarations: readonly RendererSlotDeclaration[] | undefined,
  ensureDefinition: (slot: RendererAnySlot) => void,
): readonly ErasedDeclaration[] {
  const seen = new Set<string>();
  return Object.freeze((declarations ?? []).map((declaration) => {
    if (seen.has(declaration.slot.id)) {
      throw new RendererSlotValidationError([
        `Renderer entry declares child Slot "${declaration.slot.id}" more than once.`,
      ]);
    }
    seen.add(declaration.slot.id);
    return eraseDeclaration(owner, declaration, ensureDefinition);
  }));
}

function eraseDeclaration(
  owner: RendererPluginOwner,
  declaration: RendererSlotDeclaration,
  ensureDefinition: (slot: RendererAnySlot) => void,
): ErasedDeclaration {
  ensureDefinition(declaration.slot);
  const requiredKeys = Object.freeze([
    ...((declaration.requiredKeys as readonly string[] | undefined) ?? []),
  ]);
  if (requiredKeys.length && declaration.slot.kind !== 'keyed') {
    throw new RendererSlotValidationError([
      `Slot "${declaration.slot.id}" declares required keys but is not keyed.`,
    ]);
  }
  if (new Set(requiredKeys).size !== requiredKeys.length || requiredKeys.some((key) => !key.trim())) {
    throw new RendererSlotValidationError([
      `Keyed Slot "${declaration.slot.id}" has duplicate or empty required keys.`,
    ]);
  }
  return Object.freeze({
    fallback: declaration.fallback,
    owner,
    required: declaration.required ?? false,
    requiredKeys,
    slot: declaration.slot,
  });
}

function buildSnapshot(
  version: number,
  roots: ReadonlyMap<string, ErasedDeclaration>,
  registrations: ReadonlyMap<string, ErasedRegistration>,
  preferences: RendererLayoutPreferencesV1,
  renderErrors: ReadonlyMap<string, RendererSlotRenderErrorInspection> = new Map(),
  knownChildSlotIds: ReadonlySet<string> = new Set(),
): RendererPluginSnapshot {
  return new RendererPluginSnapshot(
    version,
    roots,
    [...registrations.values()],
    preferences,
    renderErrors,
    knownChildSlotIds,
  );
}

function collectKnownChildSlotIds(
  registrations: ReadonlyMap<string, ErasedRegistration>,
  previous: ReadonlySet<string> = new Set(),
): Set<string> {
  const known = new Set(previous);
  for (const registration of registrations.values()) {
    if (!isVisualRegistration(registration)) continue;
    for (const child of registration.children) known.add(child.slot.id);
  }
  return known;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RendererSlotValidationError([`${label} must be a finite number.`]);
  }
  return value;
}
