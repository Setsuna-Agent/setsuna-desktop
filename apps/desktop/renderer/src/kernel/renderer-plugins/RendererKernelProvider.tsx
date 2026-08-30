import type {
  RendererChainSlot,
  RendererKeyedSlot,
  RendererListSlot,
  RendererOwnedSlotRenderer,
  RendererSingleSlot,
  RendererSlotScope,
  RendererVisualSlot,
} from '@setsuna-desktop/feature-core/renderer';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  type RendererPluginRuntime,
  type RendererPluginSnapshot,
  type ResolvedRendererVisualEntry,
  type ResolvedRendererVisualSlot,
} from './runtime.js';
import { RendererSlotErrorBoundary } from './RendererSlotErrorBoundary.js';

const RendererPluginRuntimeContext = createContext<RendererPluginRuntime | null>(null);
const RendererOwnedSlotsContext = createContext<RendererOwnedSlotRenderer | null>(null);

export function RendererKernelProvider({
  children,
  runtime,
}: Readonly<{
  children: ReactNode;
  runtime: RendererPluginRuntime;
}>) {
  return (
    <RendererPluginRuntimeContext.Provider value={runtime}>
      {children}
    </RendererPluginRuntimeContext.Provider>
  );
}

export function RendererOwnedSlotsProvider({
  children,
  slots,
}: Readonly<{ children: ReactNode; slots: RendererOwnedSlotRenderer }>) {
  return (
    <RendererOwnedSlotsContext.Provider value={slots}>
      {children}
    </RendererOwnedSlotsContext.Provider>
  );
}

export function useRendererOwnedSlots(): RendererOwnedSlotRenderer {
  const slots = useContext(RendererOwnedSlotsContext);
  if (!slots) throw new Error('The current Renderer contribution does not own child Slots.');
  return slots;
}

export function RendererOwnedListSlot<TProps extends object>({
  instanceKey,
  props,
  slot,
}: Readonly<{ instanceKey?: string; props: TProps; slot: RendererListSlot<TProps> }>) {
  return useRendererOwnedSlots().list(slot, props, instanceKey);
}

export function RendererOwnedSingleSlot<TProps extends object>({
  instanceKey,
  props,
  slot,
}: Readonly<{ instanceKey?: string; props: TProps; slot: RendererSingleSlot<TProps> }>) {
  return useRendererOwnedSlots().single(slot, props, instanceKey);
}

export function RendererOwnedKeyedSlot<
  TKey extends string,
  TProps extends object,
  TMetadata,
>({
  entryKey,
  instanceKey,
  props,
  slot,
}: Readonly<{
  entryKey: TKey;
  instanceKey?: string;
  props: TProps;
  slot: RendererKeyedSlot<TKey, TProps, TMetadata>;
}>) {
  return useRendererOwnedSlots().keyed(slot, entryKey, props, instanceKey);
}

export function useRendererOwnedKeyedEntries<
  TKey extends string,
  TProps extends object,
  TMetadata,
>(slot: RendererKeyedSlot<TKey, TProps, TMetadata>) {
  return useRendererOwnedSlots().keyedEntries(slot);
}

export function RendererRootSingleSlot<TProps extends object>({
  instanceKey,
  props,
  slot,
}: Readonly<{
  instanceKey?: string;
  props: TProps;
  slot: RendererSingleSlot<TProps>;
}>) {
  const snapshot = useRendererPluginSnapshot();
  return <SingleSlot instanceKey={instanceKey} snapshot={snapshot} slot={slot} props={props} />;
}

export function RendererRootListSlot<TProps extends object>({
  instanceKey,
  props,
  slot,
}: Readonly<{
  instanceKey?: string;
  props: TProps;
  slot: RendererListSlot<TProps>;
}>) {
  const snapshot = useRendererPluginSnapshot();
  return <ListSlot instanceKey={instanceKey} snapshot={snapshot} slot={slot} props={props} />;
}

export function RendererRootKeyedSlot<TKey extends string, TProps extends object, TMetadata>({
  entryKey,
  instanceKey,
  props,
  slot,
}: Readonly<{
  entryKey: TKey;
  instanceKey?: string;
  props: TProps;
  slot: RendererKeyedSlot<TKey, TProps, TMetadata>;
}>) {
  const snapshot = useRendererPluginSnapshot();
  return (
    <KeyedSlot
      entryKey={entryKey}
      instanceKey={instanceKey}
      props={props}
      slot={slot}
      snapshot={snapshot}
    />
  );
}

export function useRendererRootKeyedEntries<
  TKey extends string,
  TProps extends object,
  TMetadata,
>(slot: RendererKeyedSlot<TKey, TProps, TMetadata>) {
  return useRendererPluginSnapshot().resolveKeyedEntries(slot);
}

export function useRendererRootChain<TInput, TOutput>(
  slot: RendererChainSlot<TInput, TOutput>,
  input: TInput,
): TOutput {
  const snapshot = useRendererPluginSnapshot();
  return snapshot.resolveChain(slot, input);
}

export function useRendererRootChainResolver<TInput, TOutput>(
  slot: RendererChainSlot<TInput, TOutput>,
): (input: TInput) => TOutput {
  const snapshot = useRendererPluginSnapshot();
  return useCallback((input: TInput) => snapshot.resolveChain(slot, input), [slot, snapshot]);
}

export function useRendererPluginInspection() {
  return useRendererPluginSnapshot().inspect();
}

function useRendererPluginSnapshot(): RendererPluginSnapshot {
  const runtime = useRendererPluginRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
}

function useRendererPluginRuntime(): RendererPluginRuntime {
  const runtime = useContext(RendererPluginRuntimeContext);
  if (!runtime) throw new Error('RendererKernelProvider is missing.');
  return runtime;
}

function SingleSlot<TProps extends object>({
  instanceKey,
  parent,
  props,
  slot,
  snapshot,
}: Readonly<{
  instanceKey?: string;
  parent?: ResolvedRendererVisualEntry;
  props: TProps;
  slot: RendererSingleSlot<TProps>;
  snapshot: RendererPluginSnapshot;
}>) {
  const runtime = useRendererPluginRuntime();
  const instance = resolveRendererSlotInstance(slot, instanceKey);
  return renderResolution(snapshot.resolveSingle(slot, parent), props, snapshot, runtime, false, instance);
}

function ListSlot<TProps extends object>({
  instanceKey,
  parent,
  props,
  slot,
  snapshot,
}: Readonly<{
  instanceKey?: string;
  parent?: ResolvedRendererVisualEntry;
  props: TProps;
  slot: RendererListSlot<TProps>;
  snapshot: RendererPluginSnapshot;
}>) {
  const runtime = useRendererPluginRuntime();
  const instance = resolveRendererSlotInstance(slot, instanceKey);
  return renderResolution(snapshot.resolveList(slot, parent), props, snapshot, runtime, true, instance);
}

function KeyedSlot<TKey extends string, TProps extends object, TMetadata>({
  entryKey,
  instanceKey,
  parent,
  props,
  slot,
  snapshot,
}: Readonly<{
  entryKey: TKey;
  instanceKey?: string;
  parent?: ResolvedRendererVisualEntry;
  props: TProps;
  slot: RendererKeyedSlot<TKey, TProps, TMetadata>;
  snapshot: RendererPluginSnapshot;
}>) {
  const runtime = useRendererPluginRuntime();
  const instance = resolveRendererSlotInstance(slot, instanceKey);
  return renderResolution(
    snapshot.resolveKeyed(slot, entryKey, parent),
    props,
    snapshot,
    runtime,
    false,
    instance,
  );
}

type RendererSlotInstance = Readonly<{
  key: string;
  scope: RendererSlotScope;
}>;

function renderResolution<TProps extends object>(
  resolution: ResolvedRendererVisualSlot<TProps>,
  props: TProps,
  snapshot: RendererPluginSnapshot,
  runtime: RendererPluginRuntime,
  list: boolean,
  instance: RendererSlotInstance,
): ReactNode {
  if (!resolution.entries.length) {
    return (
      <Fragment key={rendererSlotInstanceIdentity(resolution.declaration.slot.id, instance.key)}>
        {renderDeclarationFallback(resolution, props)}
      </Fragment>
    );
  }
  return resolution.entries.map((entry) => {
    const entryInstanceIdentity = rendererSlotInstanceIdentity(entry.registrationKey, instance.key);
    return (
      <RendererSlotErrorBoundary
        fallback={(error, reset) => renderEntryErrorFallback(
          resolution,
          entry,
          error,
          props,
          list,
          reset,
        )}
        identity={`${entry.slotId}/${entry.entryId}`}
        key={entryInstanceIdentity}
        onError={(error) => runtime.reportRenderError(entry, error)}
        onReset={() => runtime.clearRenderError(entry.registrationKey)}
        resetKey={JSON.stringify([snapshot.version, entryInstanceIdentity])}
      >
        <RendererSlotEntryBody
          entry={entry}
          instance={instance}
          props={props}
          snapshot={snapshot}
        />
      </RendererSlotErrorBoundary>
    );
  });
}

function RendererSlotEntryBody<TProps extends object>({
  entry,
  instance,
  props,
  snapshot,
}: Readonly<{
  entry: ResolvedRendererVisualEntry<TProps>;
  instance: RendererSlotInstance;
  props: TProps;
  snapshot: RendererPluginSnapshot;
}>) {
  if (entry.when && !entry.when(props)) return null;
  return entry.render(props, createOwnedSlotRenderer(snapshot, entry, instance)) as ReactNode;
}

function createOwnedSlotRenderer(
  snapshot: RendererPluginSnapshot,
  parent: ResolvedRendererVisualEntry,
  parentInstance: RendererSlotInstance,
): RendererOwnedSlotRenderer {
  return Object.freeze({
    chain: <TInput, TOutput>(slot: RendererChainSlot<TInput, TOutput>, input: TInput) => (
      snapshot.resolveChain(slot, input, parent)
    ),
    single: <TProps extends object>(
      slot: RendererSingleSlot<TProps>,
      props: TProps,
      instanceKey?: string,
    ) => (
      <SingleSlot
        instanceKey={ownedSlotInstanceKey(slot, parentInstance, instanceKey)}
        parent={parent}
        props={props}
        slot={slot}
        snapshot={snapshot}
      />
    ),
    list: <TProps extends object>(
      slot: RendererListSlot<TProps>,
      props: TProps,
      instanceKey?: string,
    ) => (
      <ListSlot
        instanceKey={ownedSlotInstanceKey(slot, parentInstance, instanceKey)}
        parent={parent}
        props={props}
        slot={slot}
        snapshot={snapshot}
      />
    ),
    keyed: <TKey extends string, TProps extends object, TMetadata>(
      slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
      entryKey: TKey,
      props: TProps,
      instanceKey?: string,
    ) => (
      <KeyedSlot
        entryKey={entryKey}
        instanceKey={ownedSlotInstanceKey(slot, parentInstance, instanceKey)}
        parent={parent}
        props={props}
        slot={slot}
        snapshot={snapshot}
      />
    ),
    keyedEntries: <TKey extends string, TProps extends object, TMetadata>(
      slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
    ) => snapshot.resolveKeyedEntries(slot, parent),
  });
}

function ownedSlotInstanceKey(
  slot: RendererVisualSlot<any>,
  parent: RendererSlotInstance,
  explicitKey: string | undefined,
): string | undefined {
  if (explicitKey !== undefined) return explicitKey;
  return slot.scope === parent.scope ? parent.key : undefined;
}

function resolveRendererSlotInstance(
  slot: RendererVisualSlot<any>,
  instanceKey: string | undefined,
): RendererSlotInstance {
  if (instanceKey !== undefined && instanceKey.trim()) {
    return Object.freeze({ key: instanceKey, scope: slot.scope });
  }
  if (slot.scope === 'app') return Object.freeze({ key: 'app', scope: 'app' });
  throw new Error(
    `Renderer ${slot.scope} Slot "${slot.id}" requires a non-empty instanceKey at its outlet.`,
  );
}

function rendererSlotInstanceIdentity(ownerKey: string, instanceKey: string): string {
  return JSON.stringify([ownerKey, instanceKey]);
}

function renderDeclarationFallback<TProps extends object>(
  resolution: ResolvedRendererVisualSlot<TProps>,
  props: TProps,
): ReactNode {
  const fallback = resolution.declaration.fallback as Readonly<{
    render(fallbackProps: TProps): unknown;
  }> | undefined;
  return fallback?.render(props) as ReactNode ?? null;
}

function renderEntryErrorFallback<TProps extends object>(
  resolution: ResolvedRendererVisualSlot<TProps>,
  entry: ResolvedRendererVisualEntry<TProps>,
  error: Error,
  props: TProps,
  list: boolean,
  reset: () => void,
): ReactNode {
  if (entry.errorFallback) return entry.errorFallback(error, props, reset) as ReactNode;
  if (list) return null;
  if (resolution.declaration.fallback) return renderDeclarationFallback(resolution, props);
  // A single/keyed host surface without an explicit recovery contract must
  // reach the application boundary instead of silently turning into a blank UI.
  throw error;
}
