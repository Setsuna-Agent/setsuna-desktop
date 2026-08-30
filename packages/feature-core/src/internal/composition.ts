import {
  capabilityKey,
  eraseDependencySpec,
  type DependencySpec,
  type CapabilityRequirementDeclaration,
  type CapabilityToken,
  type HostCapabilityProvider,
  type ResolveDependencies,
} from '../capability.js';
import type { FeatureId } from '../definition.js';
import { createFeatureScope, type FeatureScopeController } from '../scope.js';
import {
  FeatureCompositionValidationError,
  FeatureReadinessError,
  type FeatureActivationStatus,
  type FeatureCompositionIssue,
  type FeatureCriticality,
  type FeatureDiagnostic,
  type FeatureHealthReporter,
  type FeatureStatusSnapshot,
} from '../status.js';
import type {
  ErasedFeatureSetupContext,
  FeatureProcess,
  ProcessFeatureModule,
} from './module.js';

export type FeatureMount<TModule> = Readonly<{
  module: TModule;
  criticality: FeatureCriticality;
}>;

export type FeatureHostDefinition<TModule> = Readonly<{
  required: readonly TModule[];
  optional: readonly TModule[];
}>;

export function createFeatureMounts<TModule>(
  definition: FeatureHostDefinition<TModule>,
): readonly FeatureMount<TModule>[] {
  return Object.freeze([
    ...definition.required.map((module) => Object.freeze({ module, criticality: 'required' as const })),
    ...definition.optional.map((module) => Object.freeze({ module, criticality: 'optional' as const })),
  ]);
}

export type FeatureActivation<TActivation> = Readonly<{
  featureId: FeatureId;
  value: TActivation;
}>;

export type FeatureComposition<TActivation = void> = Readonly<{
  activations(): readonly FeatureActivation<TActivation>[];
  statuses(): readonly FeatureStatusSnapshot[];
  status(featureId: FeatureId): FeatureStatusSnapshot | undefined;
  resolveHostDependencies<const TSpec extends DependencySpec>(spec: TSpec): ResolveDependencies<TSpec>;
  dispose(): Promise<void>;
}>;

type MutableFeatureStatus = {
  featureId: FeatureId;
  criticality: FeatureCriticality;
  status: FeatureActivationStatus | null;
  diagnostic?: FeatureDiagnostic;
};

type ActivatedFeature<TActivation> = {
  activation: FeatureActivation<TActivation>;
  scope: FeatureScopeController;
  closeHealth(): void;
};

type ProviderOwner = Readonly<{
  featureId: FeatureId | null;
  value?: unknown;
}>;

export async function composeFeatureModules<
  TProcess extends FeatureProcess,
  TActivation,
  TModule extends ProcessFeatureModule<TProcess, TActivation>,
>(input: Readonly<{
  process: TProcess;
  mounts: readonly FeatureMount<TModule>[];
  hostCapabilities?: readonly HostCapabilityProvider[];
  /** Runs only after the static graph is proven valid and before any Feature setup. */
  beforeActivation?: () => void;
  /** Process-specific setup data that is scoped to one Feature activation. */
  setupContextExtension?: (input: Readonly<{
    module: TModule;
    scope: FeatureScopeController['scope'];
  }>) => Readonly<Record<string, unknown>>;
}>): Promise<FeatureComposition<TActivation>> {
  const hostCapabilities = input.hostCapabilities ?? [];
  const validation = validateComposition(input.mounts, hostCapabilities);
  if (validation.issues.length) {
    throw new FeatureCompositionValidationError(validation.issues);
  }
  input.beforeActivation?.();

  const statuses = new Map<FeatureId, MutableFeatureStatus>();
  for (const mount of input.mounts) {
    statuses.set(mount.module.definition.id, {
      featureId: mount.module.definition.id,
      criticality: mount.criticality,
      status: null,
    });
  }

  const capabilityValues = new Map<string, ProviderOwner>();
  for (const provider of hostCapabilities) {
    capabilityValues.set(capabilityKey(provider.declaration.token), {
      featureId: null,
      value: provider.value,
    });
  }

  const activated: ActivatedFeature<TActivation>[] = [];
  let scopeSequence = 0;
  for (const module of validation.order) {
    const mount = input.mounts.find((candidate) => candidate.module === module);
    if (!mount) throw new Error(`Missing mount for Feature "${module.definition.id}".`);
    const status = statuses.get(module.definition.id);
    if (!status) throw new Error(`Missing status for Feature "${module.definition.id}".`);

    const unavailableDependency = requiredDependencyFailure(module.dependencies, validation.providerOwners, statuses);
    if (unavailableDependency) {
      status.status = 'failed';
      status.diagnostic = {
        code: 'REQUIRED_DEPENDENCY_FAILED',
        message: `Required dependency ${unavailableDependency.token.id} from Feature "${unavailableDependency.providerFeatureId}" is unavailable.`,
      };
      continue;
    }

    status.status = 'active';
    const scope = createFeatureScope({
      featureId: module.definition.id,
      scopeId: `${input.process}:${module.definition.id}:${scopeSequence}`,
      process: input.process,
    });
    scopeSequence += 1;
    const health = createHealthReporter(status);
    const stagedProviders = new Map<string, unknown>();

    try {
      const dependencies = resolveDependencies(
        module.dependencies,
        validation.providerOwners,
        capabilityValues,
        statuses,
      );
      const declaredProviderKeys = new Set(module.provides.map(({ token }) => capabilityKey(token)));
      const setupContext: ErasedFeatureSetupContext = Object.freeze({
        ...input.setupContextExtension?.({ module, scope: scope.scope }),
        scope: scope.scope,
        dependencies,
        health: health.reporter,
        provide: <TValue>(declaration: { token: CapabilityToken<TValue> }, value: TValue) => {
          const key = capabilityKey(declaration.token);
          if (!declaredProviderKeys.has(key)) {
            throw new Error(`Feature "${module.definition.id}" registered undeclared Capability ${key}.`);
          }
          if (stagedProviders.has(key)) {
            throw new Error(`Feature "${module.definition.id}" registered Capability ${key} more than once.`);
          }
          stagedProviders.set(key, value);
        },
      });

      const activation = await module.setup(setupContext);
      const missingProviders = [...declaredProviderKeys].filter((key) => !stagedProviders.has(key));
      if (missingProviders.length) {
        throw new Error(
          `Feature "${module.definition.id}" did not register declared Capability ${missingProviders.join(', ')}.`,
        );
      }

      for (const [key, value] of stagedProviders) {
        capabilityValues.set(key, { featureId: module.definition.id, value });
      }
      scope.scope.add(() => {
        for (const key of stagedProviders.keys()) {
          const current = capabilityValues.get(key);
          if (current?.featureId === module.definition.id) capabilityValues.delete(key);
        }
      });
      scope.activate();
      activated.push({
        activation: Object.freeze({ featureId: module.definition.id, value: activation }),
        scope,
        closeHealth: health.close,
      });
    } catch (error) {
      health.close();
      status.status = 'failed';
      status.diagnostic = {
        code: 'ACTIVATION_FAILED',
        message: errorMessage(error),
      };
      try {
        await scope.finishDispose();
      } catch (disposeError) {
        status.diagnostic = {
          code: 'ACTIVATION_ROLLBACK_FAILED',
          message: `${errorMessage(error)} Rollback: ${errorMessage(disposeError)}`,
        };
      }
    }
  }

  const orderedStatuses = () => input.mounts.map(({ module }) => {
    const status = statuses.get(module.definition.id);
    if (!status || !status.status) {
      throw new Error(`Feature "${module.definition.id}" did not reach an activation result.`);
    }
    return snapshotStatus(status);
  });

  if (input.mounts.some(({ module, criticality }) => {
    const result = statuses.get(module.definition.id)?.status;
    return criticality === 'required' && result === 'failed';
  })) {
    await disposeActivatedFeatures(activated);
    throw new FeatureReadinessError(orderedStatuses());
  }

  let disposePromise: Promise<void> | null = null;
  let disposed = false;
  const composition: FeatureComposition<TActivation> = Object.freeze({
    activations: () => Object.freeze(activated.map(({ activation }) => activation)),
    statuses: () => Object.freeze(orderedStatuses()),
    status: (featureId: FeatureId) => {
      const status = statuses.get(featureId);
      return status?.status ? snapshotStatus(status) : undefined;
    },
    resolveHostDependencies: <const TSpec extends DependencySpec>(spec: TSpec) => {
      if (disposed) throw new Error('Feature composition has already been disposed.');
      return resolveDependencies(
        eraseDependencySpec(spec),
        validation.providerOwners,
        capabilityValues,
        statuses,
      ) as ResolveDependencies<TSpec>;
    },
    dispose: () => {
      disposed = true;
      disposePromise ??= disposeActivatedFeatures(activated);
      return disposePromise;
    },
  });
  return composition;
}

function validateComposition<
  TActivation,
  TModule extends ProcessFeatureModule<FeatureProcess, TActivation>,
>(
  mounts: readonly FeatureMount<TModule>[],
  hostCapabilities: readonly HostCapabilityProvider[],
): Readonly<{
  issues: readonly FeatureCompositionIssue[];
  order: readonly TModule[];
  providerOwners: ReadonlyMap<string, FeatureId | null>;
}> {
  const issues: FeatureCompositionIssue[] = [];
  const featureIds = new Set<FeatureId>();
  for (const { module } of mounts) {
    if (featureIds.has(module.definition.id)) {
      issues.push({
        code: 'DUPLICATE_FEATURE_ID',
        message: `FeatureId "${module.definition.id}" is mounted more than once.`,
        featureIds: [module.definition.id],
      });
    }
    featureIds.add(module.definition.id);
  }

  const providerOwners = new Map<string, FeatureId | null>();
  for (const provider of hostCapabilities) {
    registerStaticProvider(provider.declaration.token, null, providerOwners, issues);
  }
  for (const { module } of mounts) {
    for (const declaration of module.provides) {
      registerStaticProvider(
        declaration.token,
        module.definition.id,
        providerOwners,
        issues,
      );
    }
  }

  const adjacency = new Map<FeatureId, Set<FeatureId>>(
    mounts.map(({ module }) => [module.definition.id, new Set()]),
  );
  const indegree = new Map<FeatureId, number>(
    mounts.map(({ module }) => [module.definition.id, 0]),
  );
  for (const { module } of mounts) {
    for (const requirement of module.dependencies) {
      const key = capabilityKey(requirement.token);
      const owner = providerOwners.get(key);
      if (owner === undefined) {
        if (requirement.kind === 'required') {
          issues.push({
            code: 'MISSING_CAPABILITY',
            message: `Feature "${module.definition.id}" requires missing Capability ${key}.`,
            featureIds: [module.definition.id],
          });
        }
        continue;
      }
      if (owner === null) continue;
      const consumers = adjacency.get(owner);
      if (!consumers) continue;
      if (!consumers.has(module.definition.id)) {
        consumers.add(module.definition.id);
        indegree.set(module.definition.id, (indegree.get(module.definition.id) ?? 0) + 1);
      }
    }
  }

  const mountOrder = new Map(mounts.map(({ module }, index) => [module.definition.id, index]));
  const ready = mounts
    .map(({ module }) => module.definition.id)
    .filter((featureId) => indegree.get(featureId) === 0);
  const orderedIds: FeatureId[] = [];
  while (ready.length) {
    ready.sort((left, right) => (mountOrder.get(left) ?? 0) - (mountOrder.get(right) ?? 0));
    const featureId = ready.shift();
    if (!featureId) break;
    orderedIds.push(featureId);
    for (const consumer of adjacency.get(featureId) ?? []) {
      const nextIndegree = (indegree.get(consumer) ?? 0) - 1;
      indegree.set(consumer, nextIndegree);
      if (nextIndegree === 0) ready.push(consumer);
    }
  }
  if (orderedIds.length !== mounts.length) {
    const cycleMembers = mounts
      .map(({ module }) => module.definition.id)
      .filter((featureId) => !orderedIds.includes(featureId));
    issues.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Feature dependency cycle detected: ${cycleMembers.join(' -> ')}.`,
      featureIds: cycleMembers,
    });
  }

  const moduleById = new Map(mounts.map(({ module }) => [module.definition.id, module]));
  const order = orderedIds.map((featureId) => {
    const module = moduleById.get(featureId);
    if (!module) throw new Error(`Missing Feature module "${featureId}" after graph validation.`);
    return module;
  });
  return Object.freeze({
    issues: Object.freeze(issues),
    order: Object.freeze(order),
    providerOwners,
  });
}

function registerStaticProvider(
  token: CapabilityToken<unknown>,
  featureId: FeatureId | null,
  owners: Map<string, FeatureId | null>,
  issues: FeatureCompositionIssue[],
): void {
  const key = capabilityKey(token);
  if (owners.has(key)) {
    const previousOwner = owners.get(key);
    issues.push({
      code: 'DUPLICATE_CAPABILITY_PROVIDER',
      message: `Capability ${key} is provided by both "${previousOwner ?? 'host'}" and "${featureId ?? 'host'}".`,
      featureIds: [previousOwner, featureId].filter((owner): owner is FeatureId => owner != null),
    });
    return;
  }
  owners.set(key, featureId);
}

function requiredDependencyFailure(
  requirements: readonly CapabilityRequirementDeclaration[],
  providerOwners: ReadonlyMap<string, FeatureId | null>,
  statuses: ReadonlyMap<FeatureId, MutableFeatureStatus>,
): Readonly<{ token: CapabilityToken<unknown>; providerFeatureId: FeatureId }> | undefined {
  for (const requirement of requirements) {
    if (requirement.kind !== 'required') continue;
    const providerFeatureId = providerOwners.get(capabilityKey(requirement.token));
    if (!providerFeatureId) continue;
    const providerStatus = statuses.get(providerFeatureId)?.status;
    if (providerStatus === 'failed') {
      return { token: requirement.token, providerFeatureId };
    }
  }
  return undefined;
}

function resolveDependencies(
  requirements: readonly CapabilityRequirementDeclaration[],
  providerOwners: ReadonlyMap<string, FeatureId | null>,
  values: ReadonlyMap<string, ProviderOwner>,
  statuses: ReadonlyMap<FeatureId, MutableFeatureStatus>,
): Readonly<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const requirement of requirements) {
    const key = capabilityKey(requirement.token);
    const providerFeatureId = providerOwners.get(key);
    const providerStatus = providerFeatureId ? statuses.get(providerFeatureId)?.status : undefined;
    const providerAvailable = providerFeatureId === null
      || providerStatus === 'active'
      || providerStatus === 'degraded';
    const provider = providerAvailable ? values.get(key) : undefined;
    if (provider && 'value' in provider) {
      resolved[requirement.slot] = provider.value;
      continue;
    }
    if (requirement.kind === 'optional' && requirement.fallback) {
      resolved[requirement.slot] = requirement.fallback();
      continue;
    }
    throw new Error(`Required Capability ${key} was not available while resolving dependencies.`);
  }
  return Object.freeze(resolved);
}

function createHealthReporter(status: MutableFeatureStatus): Readonly<{
  reporter: FeatureHealthReporter;
  close(): void;
}> {
  let closed = false;
  const conditions = new Map<string, FeatureDiagnostic>();
  let primaryConditionId: string | undefined;
  const publish = () => {
    // The public snapshot carries one safe diagnostic; stable condition ordering
    // prevents concurrent owners from making that summary depend on timing.
    if (primaryConditionId === undefined) {
      status.status = 'active';
      status.diagnostic = undefined;
      return;
    }
    status.status = 'degraded';
    status.diagnostic = conditions.get(primaryConditionId);
  };
  const recomputePrimaryCondition = () => {
    primaryConditionId = undefined;
    for (const conditionId of conditions.keys()) {
      if (primaryConditionId === undefined || conditionId < primaryConditionId) {
        primaryConditionId = conditionId;
      }
    }
  };
  return Object.freeze({
    reporter: Object.freeze({
      setCondition: (conditionId: string, diagnostic: FeatureDiagnostic | null) => {
        if (closed) return;
        if (diagnostic) {
          conditions.set(conditionId, Object.freeze({ ...diagnostic }));
          if (primaryConditionId === undefined || conditionId < primaryConditionId) {
            primaryConditionId = conditionId;
          }
        } else if (conditions.delete(conditionId) && conditionId === primaryConditionId) {
          // Only removing the selected diagnostic needs a linear rescan. Adds,
          // updates, and removal of other conditions remain allocation-free O(1).
          recomputePrimaryCondition();
        }
        publish();
      },
    }),
    close: () => {
      closed = true;
    },
  });
}

async function disposeActivatedFeatures<TActivation>(
  activated: readonly ActivatedFeature<TActivation>[],
): Promise<void> {
  const reversed = [...activated].reverse();
  for (const feature of reversed) {
    feature.closeHealth();
    feature.scope.beginDrain();
  }

  const errors: unknown[] = [];
  for (const feature of reversed) {
    try {
      await feature.scope.finishDispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'One or more Feature scopes failed to dispose.');
}

function snapshotStatus(status: MutableFeatureStatus): FeatureStatusSnapshot {
  if (!status.status) throw new Error(`Feature "${status.featureId}" has no activation status.`);
  return Object.freeze({
    featureId: status.featureId,
    criticality: status.criticality,
    status: status.status,
    ...(status.diagnostic ? { diagnostic: Object.freeze({ ...status.diagnostic }) } : {}),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
