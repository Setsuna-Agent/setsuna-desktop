import {
  capabilityKey,
  eraseDependencySpec,
  type DependencySpec,
  type CapabilityRequirementDeclaration,
  type CapabilityToken,
  type HostCapabilityProvider,
  type ResolveDependencies,
} from '../capability.js';
import type { FeatureDefinition, FeatureId } from '../definition.js';
import { createFeatureScope, type FeatureScopeController } from '../scope.js';
import {
  FeatureCompositionValidationError,
  FeatureReadinessError,
  type FeatureActivationStatus,
  type FeatureCompositionIssue,
  type FeatureCriticality,
  type FeatureDiagnostic,
  type FeatureHealthReporter,
  type FeatureLifecycleState,
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
  enabled: boolean;
}>;

export type FeatureComposition = Readonly<{
  installed: readonly FeatureDefinition[];
  statuses(): readonly FeatureStatusSnapshot[];
  status(featureId: FeatureId): FeatureStatusSnapshot | undefined;
  resolveHostDependencies<const TSpec extends DependencySpec>(spec: TSpec): ResolveDependencies<TSpec>;
  dispose(): Promise<void>;
}>;

type MutableFeatureStatus = {
  featureId: FeatureId;
  version: FeatureDefinition['version'];
  criticality: FeatureCriticality;
  status: FeatureActivationStatus | null;
  lifecycle: FeatureLifecycleState;
  diagnostic?: FeatureDiagnostic;
};

type ActivatedFeature = {
  module: ProcessFeatureModule<FeatureProcess>;
  scope: FeatureScopeController;
  status: MutableFeatureStatus;
  closeHealth(): void;
};

type ProviderOwner = Readonly<{
  featureId: FeatureId | null;
  value?: unknown;
}>;

export async function composeFeatureModules<
  TProcess extends FeatureProcess,
  TModule extends ProcessFeatureModule<TProcess>,
>(input: Readonly<{
  process: TProcess;
  mounts: readonly FeatureMount<TModule>[];
  hostCapabilities?: readonly HostCapabilityProvider[];
}>): Promise<FeatureComposition> {
  const installed = Object.freeze(input.mounts.map(({ module }) => module.definition));
  const enabledMounts = input.mounts.filter(({ enabled }) => enabled);
  const hostCapabilities = input.hostCapabilities ?? [];
  const validation = validateComposition(input.mounts, enabledMounts, hostCapabilities);
  if (validation.issues.length) {
    throw new FeatureCompositionValidationError(validation.issues);
  }

  const statuses = new Map<FeatureId, MutableFeatureStatus>();
  for (const mount of enabledMounts) {
    statuses.set(mount.module.definition.id, {
      featureId: mount.module.definition.id,
      version: mount.module.definition.version,
      criticality: mount.criticality,
      status: null,
      lifecycle: 'declared',
    });
  }

  const capabilityValues = new Map<string, ProviderOwner>();
  for (const provider of hostCapabilities) {
    capabilityValues.set(capabilityKey(provider.declaration.token), {
      featureId: null,
      value: provider.value,
    });
  }

  const activated: ActivatedFeature[] = [];
  let scopeSequence = 0;
  for (const module of validation.order) {
    const mount = enabledMounts.find((candidate) => candidate.module === module);
    if (!mount) throw new Error(`Missing mount for Feature "${module.definition.id}".`);
    const status = statuses.get(module.definition.id);
    if (!status) throw new Error(`Missing status for Feature "${module.definition.id}".`);

    const blockedBy = requiredDependencyFailure(module.dependencies, validation.providerOwners, statuses);
    if (blockedBy) {
      status.status = 'blocked';
      status.lifecycle = 'stopped';
      status.diagnostic = {
        code: 'REQUIRED_DEPENDENCY_FAILED',
        message: `Required dependency ${blockedBy.token.id}@${blockedBy.token.major} from Feature "${blockedBy.providerFeatureId}" is unavailable.`,
      };
      continue;
    }

    status.lifecycle = 'starting';
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

      await module.setup(setupContext);
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
      status.lifecycle = activationStatus(status) === 'degraded' ? 'degraded' : 'active';
      activated.push({ module, scope, status, closeHealth: health.close });
    } catch (error) {
      health.close();
      status.status = 'failed';
      status.lifecycle = 'draining';
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
      status.lifecycle = 'stopped';
    }
  }

  const orderedStatuses = () => enabledMounts.map(({ module }) => {
    const status = statuses.get(module.definition.id);
    if (!status || !status.status) {
      throw new Error(`Feature "${module.definition.id}" did not reach an activation result.`);
    }
    return snapshotStatus(status);
  });

  if (enabledMounts.some(({ module, criticality }) => {
    const result = statuses.get(module.definition.id)?.status;
    return criticality === 'required' && (result === 'failed' || result === 'blocked');
  })) {
    await disposeActivatedFeatures(activated);
    throw new FeatureReadinessError(orderedStatuses());
  }

  let disposePromise: Promise<void> | null = null;
  let disposed = false;
  const composition: FeatureComposition = Object.freeze({
    installed,
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

function validateComposition<TModule extends ProcessFeatureModule<FeatureProcess>>(
  allMounts: readonly FeatureMount<TModule>[],
  enabledMounts: readonly FeatureMount<TModule>[],
  hostCapabilities: readonly HostCapabilityProvider[],
): Readonly<{
  issues: readonly FeatureCompositionIssue[];
  order: readonly TModule[];
  providerOwners: ReadonlyMap<string, FeatureId | null>;
}> {
  const issues: FeatureCompositionIssue[] = [];
  const featureIds = new Set<FeatureId>();
  for (const { module } of allMounts) {
    if (featureIds.has(module.definition.id)) {
      issues.push({
        code: 'DUPLICATE_FEATURE_ID',
        message: `FeatureId "${module.definition.id}" is mounted more than once.`,
      });
    }
    featureIds.add(module.definition.id);
  }

  const providerOwners = new Map<string, FeatureId | null>();
  const providerTokens = new Map<string, CapabilityToken<unknown>>();
  for (const provider of hostCapabilities) {
    registerStaticProvider(provider.declaration.token, null, providerOwners, providerTokens, issues);
  }
  for (const { module } of enabledMounts) {
    for (const declaration of module.provides) {
      registerStaticProvider(
        declaration.token,
        module.definition.id,
        providerOwners,
        providerTokens,
        issues,
      );
    }
  }

  const adjacency = new Map<FeatureId, Set<FeatureId>>(
    enabledMounts.map(({ module }) => [module.definition.id, new Set()]),
  );
  const indegree = new Map<FeatureId, number>(
    enabledMounts.map(({ module }) => [module.definition.id, 0]),
  );
  for (const { module } of enabledMounts) {
    for (const requirement of module.dependencies) {
      const key = capabilityKey(requirement.token);
      const owner = providerOwners.get(key);
      if (owner === undefined) {
        if (requirement.kind === 'required') {
          const incompatible = [...providerTokens.values()].filter(
            (token) => token.id === requirement.token.id && token.major !== requirement.token.major,
          );
          issues.push({
            code: incompatible.length ? 'CAPABILITY_MAJOR_MISMATCH' : 'MISSING_CAPABILITY',
            message: incompatible.length
              ? `Feature "${module.definition.id}" requires ${key}, but available major versions are ${incompatible.map((token) => token.major).join(', ')}.`
              : `Feature "${module.definition.id}" requires missing Capability ${key}.`,
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

  const mountOrder = new Map(enabledMounts.map(({ module }, index) => [module.definition.id, index]));
  const ready = enabledMounts
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
  if (orderedIds.length !== enabledMounts.length) {
    const cycleMembers = enabledMounts
      .map(({ module }) => module.definition.id)
      .filter((featureId) => !orderedIds.includes(featureId));
    issues.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Feature dependency cycle detected: ${cycleMembers.join(' -> ')}.`,
    });
  }

  const moduleById = new Map(enabledMounts.map(({ module }) => [module.definition.id, module]));
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
  tokens: Map<string, CapabilityToken<unknown>>,
  issues: FeatureCompositionIssue[],
): void {
  const key = capabilityKey(token);
  if (owners.has(key)) {
    const previousOwner = owners.get(key);
    issues.push({
      code: 'DUPLICATE_CAPABILITY_PROVIDER',
      message: `Capability ${key} is provided by both "${previousOwner ?? 'host'}" and "${featureId ?? 'host'}".`,
    });
    return;
  }
  owners.set(key, featureId);
  tokens.set(key, token);
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
    if (providerStatus === 'failed' || providerStatus === 'blocked') {
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
  return Object.freeze({
    reporter: Object.freeze({
      markActive: () => {
        if (closed || status.lifecycle === 'draining' || status.lifecycle === 'stopped') return;
        status.status = 'active';
        status.diagnostic = undefined;
        if (status.lifecycle !== 'starting') status.lifecycle = 'active';
      },
      markDegraded: (diagnostic: FeatureDiagnostic) => {
        if (closed || status.lifecycle === 'draining' || status.lifecycle === 'stopped') return;
        status.status = 'degraded';
        status.diagnostic = Object.freeze({ ...diagnostic });
        if (status.lifecycle !== 'starting') status.lifecycle = 'degraded';
      },
    }),
    close: () => {
      closed = true;
    },
  });
}

async function disposeActivatedFeatures(activated: readonly ActivatedFeature[]): Promise<void> {
  const reversed = [...activated].reverse();
  for (const feature of reversed) {
    feature.closeHealth();
    feature.status.lifecycle = 'draining';
    feature.scope.beginDrain();
  }

  const errors: unknown[] = [];
  for (const feature of reversed) {
    try {
      await feature.scope.finishDispose();
    } catch (error) {
      errors.push(error);
    } finally {
      feature.status.lifecycle = 'stopped';
    }
  }
  if (errors.length) throw new AggregateError(errors, 'One or more Feature scopes failed to dispose.');
}

function snapshotStatus(status: MutableFeatureStatus): FeatureStatusSnapshot {
  if (!status.status) throw new Error(`Feature "${status.featureId}" has no activation status.`);
  return Object.freeze({
    featureId: status.featureId,
    version: status.version,
    criticality: status.criticality,
    status: status.status,
    lifecycle: status.lifecycle,
    ...(status.diagnostic ? { diagnostic: Object.freeze({ ...status.diagnostic }) } : {}),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activationStatus(status: MutableFeatureStatus): FeatureActivationStatus | null {
  return status.status;
}
