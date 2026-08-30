import type {
  RendererAnySlot,
  RendererKeyedSlot,
  RendererListSlot,
  RendererPluginOwner,
  RendererSingleSlot,
  RendererSlotKind,
} from '@setsuna-desktop/feature-core/renderer';
import {
  emptyRendererLayoutPreferences,
  type RendererLayoutPreferencesV1,
} from './layout-preferences.js';
import type {
  ErasedDeclaration,
  ErasedRegistration,
  ErasedVisualRegistration,
  ResolvedRendererVisualEntry,
} from './runtime.js';

export type RendererSlotCandidateState = 'active' | 'eligible' | 'shadowed' | 'dormant' | 'hidden';

export type RendererStaleLayoutPreference = Readonly<{
  entryId?: string;
  key?: string;
  reason: 'entry-missing' | 'kind-mismatch' | 'slot-missing' | 'slot-not-configurable';
  slotId: string;
}>;

export type RendererSlotRenderErrorInspection = Readonly<{
  entryId: string;
  errorName: string;
  owner: RendererPluginOwner;
  reportedAt: string;
  slotId: string;
}>;

export type RendererSlotInspectionCandidate = Readonly<{
  entryId: string;
  key?: string;
  owner: RendererPluginOwner;
  priority?: number;
  order?: number;
  slotId: string;
  state: RendererSlotCandidateState;
}>;

export type RendererSlotInspectionNode = Readonly<{
  activeEntryIds: readonly string[];
  candidates: readonly RendererSlotInspectionCandidate[];
  children: readonly RendererSlotInspectionNode[];
  declaredBy: RendererPluginOwner;
  defaultActiveEntryIds: readonly string[];
  kind: RendererSlotKind;
  path: string;
  required: boolean;
  requiredKeys: readonly string[];
  slotId: string;
}>;

export type RendererSlotInspection = Readonly<{
  dormant: readonly RendererSlotInspectionCandidate[];
  roots: readonly RendererSlotInspectionNode[];
  renderErrors: readonly RendererSlotRenderErrorInspection[];
  snapshotVersion: number;
  stalePreferences: readonly RendererStaleLayoutPreference[];
}>;

export function inspectRendererSnapshot(input: Readonly<{
  bySlot: ReadonlyMap<string, readonly ErasedRegistration[]>;
  preferences: RendererLayoutPreferencesV1;
  registrationsByKey: ReadonlyMap<string, ErasedRegistration>;
  renderErrors: ReadonlyMap<string, RendererSlotRenderErrorInspection>;
  roots: ReadonlyMap<string, ErasedDeclaration>;
  snapshotVersion: number;
}>): RendererSlotInspection {
  const activeRegistrationKeys = new Set<string>();
  const reachableRegistrationKeys = new Set<string>();
  const roots = [...input.roots.values()]
    .sort((left, right) => left.slot.id.localeCompare(right.slot.id))
    .map((declaration) => inspectDeclaration(
      declaration,
      declaration.slot.id,
      input.bySlot,
      input.preferences,
      activeRegistrationKeys,
      reachableRegistrationKeys,
    ));
  const dormant = [...input.registrationsByKey.values()]
    .filter((registration) => !reachableRegistrationKeys.has(registration.registrationKey))
    .sort(compareRegistrationIdentity)
    .map((registration) => inspectionCandidate(registration, 'dormant'));
  return Object.freeze({
    dormant: Object.freeze(dormant),
    renderErrors: Object.freeze([...input.renderErrors.values()].sort((left, right) => (
      left.slotId.localeCompare(right.slotId) || left.entryId.localeCompare(right.entryId)
    ))),
    roots: Object.freeze(roots),
    snapshotVersion: input.snapshotVersion,
    stalePreferences: Object.freeze(inspectStalePreferences(
      input.preferences,
      input.roots,
      input.bySlot,
    )),
  });
}

function inspectDeclaration(
  declaration: ErasedDeclaration,
  path: string,
  bySlot: ReadonlyMap<string, readonly ErasedRegistration[]>,
  preferences: RendererLayoutPreferencesV1,
  activeKeys: Set<string>,
  reachableKeys: Set<string>,
): RendererSlotInspectionNode {
  const registrations = [...(bySlot.get(declaration.slot.id) ?? [])];
  for (const registration of registrations) reachableKeys.add(registration.registrationKey);
  const active = activeRegistrations(declaration.slot, registrations, preferences);
  const defaultActive = activeRegistrations(
    declaration.slot,
    registrations,
    emptyRendererLayoutPreferences(),
  );
  for (const registration of active) activeKeys.add(registration.registrationKey);
  const activeSet = new Set(active.map(({ registrationKey }) => registrationKey));
  const defaultActiveSet = new Set(defaultActive.map(({ registrationKey }) => registrationKey));
  const hiddenEntryIds = declaration.slot.kind === 'list' && declaration.slot.userConfigurable
    ? new Set(preferences.listPreferences[declaration.slot.id]?.hiddenEntryIds ?? [])
    : new Set<string>();
  const candidates = registrations
    .sort(compareRegistrationIdentity)
    .map((registration) => inspectionCandidate(
      registration,
      activeSet.has(registration.registrationKey)
        ? 'active'
        : hiddenEntryIds.has(registration.entryId)
          ? 'hidden'
          : defaultActiveSet.has(registration.registrationKey)
            ? 'eligible'
            : 'shadowed',
    ));
  const children = active
    .filter(isVisualRegistration)
    .flatMap((entry) => entry.children.map((child) => inspectDeclaration(
      child,
      `${path}/${entry.entryId}/${child.slot.id}`,
      bySlot,
      preferences,
      activeKeys,
      reachableKeys,
    )));
  return Object.freeze({
    activeEntryIds: Object.freeze(active.map(({ entryId }) => entryId)),
    candidates: Object.freeze(candidates),
    children: Object.freeze(children),
    declaredBy: declaration.owner,
    defaultActiveEntryIds: Object.freeze(defaultActive.map(({ entryId }) => entryId)),
    kind: declaration.slot.kind,
    path,
    required: declaration.required,
    requiredKeys: declaration.requiredKeys,
    slotId: declaration.slot.id,
  });
}

export function activeRegistrations(
  slot: RendererAnySlot,
  entries: readonly ErasedRegistration[],
  preferences: RendererLayoutPreferencesV1,
): ErasedRegistration[] {
  if (slot.kind === 'list') {
    return selectListRegistrations(
      slot as RendererListSlot<any>,
      entries.filter(isVisualRegistration),
      preferences,
    );
  }
  if (slot.kind === 'keyed') {
    const byKey = new Map<string, ErasedRegistration[]>();
    for (const entry of entries.filter(isVisualRegistration)) {
      const keyEntries = byKey.get(entry.key ?? '') ?? [];
      keyEntries.push(entry);
      byKey.set(entry.key ?? '', keyEntries);
    }
    return [...byKey].flatMap(([key, keyEntries]) => selectKeyedRegistration(
      slot as RendererKeyedSlot<string, any, unknown>,
      key,
      keyEntries.filter(isVisualRegistration),
      preferences,
    ));
  }
  if (slot.kind === 'chain') return [...entries].sort(comparePriority);
  return selectSingleRegistration(
    slot as RendererSingleSlot<any>,
    entries.filter(isVisualRegistration),
    preferences,
  );
}

export function selectSingleRegistration<TProps extends object>(
  slot: RendererSingleSlot<TProps>,
  entries: readonly ErasedVisualRegistration[],
  preferences: RendererLayoutPreferencesV1,
): ErasedVisualRegistration[] {
  const defaults = [...entries].sort(comparePriority);
  if (!slot.userConfigurable) return defaults.slice(0, 1);
  const preferredEntryId = preferences.singleSelections[slot.id];
  if (!preferredEntryId) return defaults.slice(0, 1);
  const preferred = entries.find((entry) => entry.entryId === preferredEntryId);
  return preferred ? [preferred] : defaults.slice(0, 1);
}

export function selectKeyedRegistration<TKey extends string, TProps extends object, TMetadata>(
  slot: RendererKeyedSlot<TKey, TProps, TMetadata>,
  key: TKey,
  entries: readonly ErasedVisualRegistration[],
  preferences: RendererLayoutPreferencesV1,
): ErasedVisualRegistration[] {
  const candidates = entries.filter((entry) => entry.key === key).sort(comparePriority);
  if (!slot.userConfigurable) return candidates.slice(0, 1);
  const preferredEntryId = preferences.keyedSelections[slot.id]?.[key];
  if (!preferredEntryId) return candidates.slice(0, 1);
  const preferred = candidates.find((entry) => entry.entryId === preferredEntryId);
  return preferred ? [preferred] : candidates.slice(0, 1);
}

export function selectListRegistrations<TProps extends object>(
  slot: RendererListSlot<TProps>,
  entries: readonly ErasedVisualRegistration[],
  preferences: RendererLayoutPreferencesV1,
): ErasedVisualRegistration[] {
  const defaults = [...entries].sort(compareListOrder);
  if (!slot.userConfigurable) return defaults;
  const preference = preferences.listPreferences[slot.id];
  if (!preference) return defaults;
  const hidden = new Set(preference.hiddenEntryIds ?? []);
  const explicitOrder = new Map((preference.order ?? []).map((entryId, index) => [entryId, index]));
  return defaults
    .filter((entry) => !hidden.has(entry.entryId))
    .sort((left, right) => {
      const leftIndex = explicitOrder.get(left.entryId);
      const rightIndex = explicitOrder.get(right.entryId);
      if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return compareListOrder(left, right);
    });
}

function inspectStalePreferences(
  preferences: RendererLayoutPreferencesV1,
  roots: ReadonlyMap<string, ErasedDeclaration>,
  bySlot: ReadonlyMap<string, readonly ErasedRegistration[]>,
): RendererStaleLayoutPreference[] {
  const slots = new Map<string, RendererAnySlot>();
  const rememberDeclaration = (declaration: ErasedDeclaration) => {
    slots.set(declaration.slot.id, declaration.slot);
  };
  for (const declaration of roots.values()) rememberDeclaration(declaration);
  for (const registrations of bySlot.values()) {
    for (const registration of registrations) {
      slots.set(registration.slot.id, registration.slot);
      if (isVisualRegistration(registration)) {
        for (const child of registration.children) rememberDeclaration(child);
      }
    }
  }

  const stale: RendererStaleLayoutPreference[] = [];
  const validateReference = (
    slotId: string,
    expectedKind: 'single' | 'keyed' | 'list',
    entryId: string,
    key?: string,
  ) => {
    const slot = slots.get(slotId);
    if (!slot) {
      stale.push({ entryId, key, reason: 'slot-missing', slotId });
      return;
    }
    if (!slot.userConfigurable) {
      stale.push({ entryId, key, reason: 'slot-not-configurable', slotId });
      return;
    }
    if (slot.kind !== expectedKind) {
      stale.push({ entryId, key, reason: 'kind-mismatch', slotId });
      return;
    }
    const exists = (bySlot.get(slotId) ?? []).some((entry) => (
      entry.entryId === entryId
      && (expectedKind !== 'keyed' || (isVisualRegistration(entry) && entry.key === key))
    ));
    if (!exists) stale.push({ entryId, key, reason: 'entry-missing', slotId });
  };

  for (const [slotId, entryId] of Object.entries(preferences.singleSelections)) {
    validateReference(slotId, 'single', entryId);
  }
  for (const [slotId, keyedSelections] of Object.entries(preferences.keyedSelections)) {
    for (const [key, entryId] of Object.entries(keyedSelections)) {
      validateReference(slotId, 'keyed', entryId, key);
    }
  }
  for (const [slotId, preference] of Object.entries(preferences.listPreferences)) {
    for (const entryId of preference.hiddenEntryIds ?? []) {
      validateReference(slotId, 'list', entryId);
    }
    for (const entryId of preference.order ?? []) {
      validateReference(slotId, 'list', entryId);
    }
  }
  return stale.sort((left, right) => left.slotId.localeCompare(right.slotId)
    || (left.key ?? '').localeCompare(right.key ?? '')
    || (left.entryId ?? '').localeCompare(right.entryId ?? ''));
}

function inspectionCandidate(
  registration: ErasedRegistration,
  state: RendererSlotCandidateState,
): RendererSlotInspectionCandidate {
  return Object.freeze({
    entryId: registration.entryId,
    ...(isVisualRegistration(registration) && registration.key !== undefined
      ? { key: registration.key }
      : {}),
    owner: registration.owner,
    ...(registration.priority !== 0 ? { priority: registration.priority } : {}),
    ...(isVisualRegistration(registration) && registration.order !== undefined
      ? { order: registration.order }
      : {}),
    slotId: registration.slot.id,
    state,
  });
}

export function resolveVisualEntry<TProps extends object>(
  entry: ErasedVisualRegistration,
): ResolvedRendererVisualEntry<TProps> {
  return Object.freeze({
    children: entry.children,
    entryId: entry.entryId,
    errorFallback: entry.errorFallback,
    mountEpoch: entry.mountEpoch,
    metadata: entry.metadata,
    owner: entry.owner,
    registrationKey: entry.registrationKey,
    render: entry.render,
    slotId: entry.slot.id,
    key: entry.key,
    when: entry.when,
  });
}

export function isVisualRegistration(
  entry: ErasedRegistration,
): entry is ErasedVisualRegistration {
  return entry.slot.kind !== 'chain';
}

export function isChainRegistration(
  entry: ErasedRegistration,
): entry is Exclude<ErasedRegistration, ErasedVisualRegistration> {
  return entry.slot.kind === 'chain';
}

export function comparePriority(
  left: ErasedRegistration,
  right: ErasedRegistration,
): number {
  return right.priority - left.priority || compareRegistrationIdentity(left, right);
}

function compareListOrder(left: ErasedRegistration, right: ErasedRegistration): number {
  const leftOrder = isVisualRegistration(left) ? left.order ?? 0 : 0;
  const rightOrder = isVisualRegistration(right) ? right.order ?? 0 : 0;
  return leftOrder - rightOrder || compareRegistrationIdentity(left, right);
}

export function compareRegistrationIdentity(
  left: ErasedRegistration,
  right: ErasedRegistration,
): number {
  return left.entryId.localeCompare(right.entryId)
    || left.owner.pluginId.localeCompare(right.owner.pluginId)
    || left.mountEpoch - right.mountEpoch;
}
