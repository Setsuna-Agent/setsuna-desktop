import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  declareCapabilityProvider,
  defineCapability,
  optionalCapability,
  requiredCapability,
} from '../../src/capability.js';
import { defineFeatureDefinition, type FeatureId } from '../../src/definition.js';
import {
  composeRuntimeFeatures,
  defineRuntimeDependencies,
  defineRuntimeFeature,
  mountRuntimeFeature,
} from '../../src/runtime/index.js';
import type { FeatureScope } from '../../src/scope.js';
import {
  FeatureCompositionValidationError,
  FeatureReadinessError,
  FeatureScopeUnavailableError,
} from '../../src/status.js';

type Greeter = Readonly<{ greet(name: string): string }>;

const greeterCapability = defineCapability<Greeter>({
  id: 'fixture.greeter',
  major: 1,
  description: 'Greets a fixture consumer',
});
const greeterDeclaration = declareCapabilityProvider(greeterCapability);

describe('Feature composition kernel', () => {
  it('builds a typed graph before setup and disposes consumers before providers', async () => {
    const effects: string[] = [];
    const provider = defineRuntimeFeature({
      definition: feature('fixture-provider'),
      provides: [greeterDeclaration],
      dependencies: defineRuntimeDependencies({}),
      setup({ scope, provide }) {
        effects.push('provider:setup');
        provide(greeterDeclaration, { greet: (name) => `hello ${name}` });
        scope.add(() => {
          effects.push('provider:dispose:first');
        });
        scope.add(() => {
          effects.push('provider:dispose:second');
        });
      },
    });
    const consumer = defineRuntimeFeature({
      definition: feature('fixture-consumer'),
      provides: [],
      dependencies: defineRuntimeDependencies({
        greeter: requiredCapability(greeterCapability),
      }),
      setup({ dependencies, scope }) {
        expectTypeOf(dependencies.greeter).toEqualTypeOf<Greeter>();
        effects.push(dependencies.greeter.greet('consumer'));
        scope.add(() => {
          effects.push('consumer:dispose');
        });
      },
    });

    const composition = await composeRuntimeFeatures({
      // Reverse mount order proves setup order comes from the dependency graph.
      mounts: [
        mountRuntimeFeature(consumer, { criticality: 'required' }),
        mountRuntimeFeature(provider, { criticality: 'required' }),
      ],
    });

    expect(effects).toEqual(['provider:setup', 'hello consumer']);
    expect(composition.statuses().map(({ status }) => status)).toEqual(['active', 'active']);
    await composition.dispose();
    await composition.dispose();
    expect(effects).toEqual([
      'provider:setup',
      'hello consumer',
      'consumer:dispose',
      'provider:dispose:second',
      'provider:dispose:first',
    ]);
  });

  it('rejects invalid graphs without executing setup', async () => {
    let setupCount = 0;
    const missingV2 = defineCapability<Greeter>({
      id: greeterCapability.id,
      major: 2,
      description: 'Incompatible fixture major',
    });
    const consumer = defineRuntimeFeature({
      definition: feature('invalid-consumer'),
      provides: [],
      dependencies: defineRuntimeDependencies({ greeter: requiredCapability(missingV2) }),
      setup() {
        setupCount += 1;
      },
    });
    const provider = defineRuntimeFeature({
      definition: feature('invalid-provider'),
      provides: [greeterDeclaration],
      dependencies: defineRuntimeDependencies({}),
      setup({ provide }) {
        setupCount += 1;
        provide(greeterDeclaration, { greet: () => 'unused' });
      },
    });

    const error = await captureError(() => composeRuntimeFeatures({
      mounts: [
        mountRuntimeFeature(consumer, { criticality: 'optional' }),
        mountRuntimeFeature(provider, { criticality: 'optional' }),
      ],
    }));

    expect(error).toBeInstanceOf(FeatureCompositionValidationError);
    expect((error as FeatureCompositionValidationError).issues).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_MAJOR_MISMATCH',
    }));
    expect(setupCount).toBe(0);
  });

  it('detects duplicate providers and dependency cycles before readiness', async () => {
    const firstCapability = defineCapability<object>({
      id: 'fixture.first',
      major: 1,
      description: 'First cycle edge',
    });
    const secondCapability = defineCapability<object>({
      id: 'fixture.second',
      major: 1,
      description: 'Second cycle edge',
    });
    const firstDeclaration = declareCapabilityProvider(firstCapability);
    const secondDeclaration = declareCapabilityProvider(secondCapability);
    const first = defineRuntimeFeature({
      definition: feature('cycle-first'),
      provides: [firstDeclaration],
      dependencies: defineRuntimeDependencies({ second: requiredCapability(secondCapability) }),
      setup({ provide }) {
        provide(firstDeclaration, {});
      },
    });
    const second = defineRuntimeFeature({
      definition: feature('cycle-second'),
      provides: [secondDeclaration, firstDeclaration],
      dependencies: defineRuntimeDependencies({ first: requiredCapability(firstCapability) }),
      setup({ provide }) {
        provide(secondDeclaration, {});
        provide(firstDeclaration, {});
      },
    });

    const error = await captureError(() => composeRuntimeFeatures({
      mounts: [
        mountRuntimeFeature(first, { criticality: 'optional' }),
        mountRuntimeFeature(second, { criticality: 'optional' }),
      ],
    }));

    expect(error).toBeInstanceOf(FeatureCompositionValidationError);
    const codes = (error as FeatureCompositionValidationError).issues.map(({ code }) => code);
    expect(codes).toContain('DUPLICATE_CAPABILITY_PROVIDER');
    expect(codes).toContain('DEPENDENCY_CYCLE');
  });

  it('rejects duplicate Feature IDs and missing required capabilities', async () => {
    const missingCapability = defineCapability<object>({
      id: 'fixture.missing',
      major: 1,
      description: 'Intentionally absent fixture capability',
    });
    const first = defineRuntimeFeature({
      definition: feature('duplicate-feature'),
      provides: [],
      dependencies: defineRuntimeDependencies({ missing: requiredCapability(missingCapability) }),
      setup() {
        throw new Error('setup must not run');
      },
    });
    const second = defineRuntimeFeature({
      definition: feature('duplicate-feature'),
      provides: [],
      dependencies: defineRuntimeDependencies({}),
      setup() {
        throw new Error('setup must not run');
      },
    });

    const error = await captureError(() => composeRuntimeFeatures({
      mounts: [
        mountRuntimeFeature(first, { criticality: 'optional' }),
        mountRuntimeFeature(second, { criticality: 'optional' }),
      ],
    }));

    expect(error).toBeInstanceOf(FeatureCompositionValidationError);
    const codes = (error as FeatureCompositionValidationError).issues.map(({ code }) => code);
    expect(codes).toContain('DUPLICATE_FEATURE_ID');
    expect(codes).toContain('MISSING_CAPABILITY');
  });

  it('rolls back a failed provider, blocks required consumers, and gives optional consumers their fallback', async () => {
    const effects: string[] = [];
    const failedProvider = defineRuntimeFeature({
      definition: feature('failed-provider'),
      provides: [greeterDeclaration],
      dependencies: defineRuntimeDependencies({}),
      setup({ scope }) {
        scope.add(() => {
          effects.push('provider:rollback');
        });
        throw new Error('provider setup exploded');
      },
    });
    const blockedConsumer = defineRuntimeFeature({
      definition: feature('blocked-consumer'),
      provides: [],
      dependencies: defineRuntimeDependencies({ greeter: requiredCapability(greeterCapability) }),
      setup() {
        effects.push('blocked:setup');
      },
    });
    const fallbackConsumer = defineRuntimeFeature({
      definition: feature('fallback-consumer'),
      provides: [],
      dependencies: defineRuntimeDependencies({
        greeter: optionalCapability(greeterCapability, () => ({ greet: () => 'fallback' })),
      }),
      setup({ dependencies }) {
        effects.push(dependencies.greeter.greet('ignored'));
      },
    });

    const composition = await composeRuntimeFeatures({
      mounts: [failedProvider, blockedConsumer, fallbackConsumer].map((module) => (
        mountRuntimeFeature(module, { criticality: 'optional' })
      )),
    });

    expect(effects).toEqual(['provider:rollback', 'fallback']);
    expect(statusMap(composition.statuses())).toEqual({
      'failed-provider': 'failed',
      'blocked-consumer': 'blocked',
      'fallback-consumer': 'active',
    });
    await composition.dispose();
  });

  it('fails readiness for a required blocked Feature and tears down independent scopes', async () => {
    const effects: string[] = [];
    const independent = defineRuntimeFeature({
      definition: feature('required-independent'),
      provides: [],
      dependencies: defineRuntimeDependencies({}),
      setup({ scope }) {
        effects.push('independent:setup');
        scope.add(() => {
          effects.push('independent:dispose');
        });
      },
    });
    const failedProvider = defineRuntimeFeature({
      definition: feature('required-provider'),
      provides: [greeterDeclaration],
      dependencies: defineRuntimeDependencies({}),
      setup() {
        throw new Error('structural failure');
      },
    });
    const requiredConsumer = defineRuntimeFeature({
      definition: feature('required-consumer'),
      provides: [],
      dependencies: defineRuntimeDependencies({ greeter: requiredCapability(greeterCapability) }),
      setup() {
        effects.push('consumer:setup');
      },
    });

    const error = await captureError(() => composeRuntimeFeatures({
      mounts: [
        mountRuntimeFeature(independent, { criticality: 'optional' }),
        mountRuntimeFeature(failedProvider, { criticality: 'optional' }),
        mountRuntimeFeature(requiredConsumer, { criticality: 'required' }),
      ],
    }));

    expect(error).toBeInstanceOf(FeatureReadinessError);
    expect(effects).toEqual(['independent:setup', 'independent:dispose']);
    expect(statusMap((error as FeatureReadinessError).statuses)).toMatchObject({
      'required-provider': 'failed',
      'required-consumer': 'blocked',
    });
  });

  it('keeps degraded scopes active and supports in-place health recovery', async () => {
    const captured: {
      scope?: FeatureScope;
      markActive?: () => void;
      markDegraded?: () => void;
    } = {};
    const module = defineRuntimeFeature({
      definition: feature('degraded-feature'),
      provides: [],
      dependencies: defineRuntimeDependencies({}),
      setup(context) {
        captured.scope = context.scope;
        captured.markActive = () => context.health.markActive();
        captured.markDegraded = () => context.health.markDegraded({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Fixture provider is offline.',
        });
        captured.markDegraded();
      },
    });
    const composition = await composeRuntimeFeatures({
      mounts: [mountRuntimeFeature(module, { criticality: 'required' })],
    });

    expect(composition.statuses()[0]).toMatchObject({ status: 'degraded', lifecycle: 'degraded' });
    await expect(requireValue(captured.scope).runOperation(async () => 'available management operation')).resolves.toBe(
      'available management operation',
    );
    captured.markActive?.();
    expect(composition.statuses()[0]).toMatchObject({ status: 'active', lifecycle: 'active' });
    captured.markDegraded?.();
    expect(composition.statuses()[0]).toMatchObject({ status: 'degraded', lifecycle: 'degraded' });
    await composition.dispose();
  });

  it('closes every operation gate before waiting for leases and disposes resources afterward', async () => {
    const captured: {
      scope?: FeatureScope;
      releaseOperation?: () => void;
      operationStarted?: () => void;
    } = {};
    const started = new Promise<void>((resolve) => {
      captured.operationStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      captured.releaseOperation = resolve;
    });
    const effects: string[] = [];
    const module = defineRuntimeFeature({
      definition: feature('lease-feature'),
      provides: [],
      dependencies: defineRuntimeDependencies({}),
      setup(context) {
        captured.scope = context.scope;
        context.scope.add(() => {
          effects.push('resource:dispose');
        });
      },
    });
    const composition = await composeRuntimeFeatures({
      mounts: [mountRuntimeFeature(module, { criticality: 'required' })],
    });
    const scope = requireValue(captured.scope);
    const operation = scope.runOperation(async (signal) => {
      captured.operationStarted?.();
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      effects.push('operation:aborted');
      await release;
      effects.push('operation:released');
    });
    await started;

    const disposing = composition.dispose();
    await expect(scope.runOperation(async () => undefined)).rejects.toBeInstanceOf(
      FeatureScopeUnavailableError,
    );
    expect(effects).toEqual(['operation:aborted']);
    captured.releaseOperation?.();
    await operation;
    await disposing;
    expect(effects).toEqual(['operation:aborted', 'operation:released', 'resource:dispose']);
  });

  it('fails activation when declared and actual providers differ and rolls setup effects back', async () => {
    const effects: string[] = [];
    const module = defineRuntimeFeature({
      definition: feature('missing-registration'),
      provides: [greeterDeclaration],
      dependencies: defineRuntimeDependencies({}),
      setup({ scope }) {
        scope.add(() => {
          effects.push('rollback');
        });
      },
    });
    const composition = await composeRuntimeFeatures({
      mounts: [mountRuntimeFeature(module, { criticality: 'optional' })],
    });

    expect(composition.statuses()[0]).toMatchObject({ status: 'failed', lifecycle: 'stopped' });
    expect(effects).toEqual(['rollback']);
  });

  it('fails activation when setup registers an undeclared provider', async () => {
    const module = defineRuntimeFeature({
      definition: feature('undeclared-registration'),
      provides: [],
      dependencies: defineRuntimeDependencies({}),
      setup({ provide }) {
        provide(greeterDeclaration, { greet: () => 'invalid' });
      },
    });
    const composition = await composeRuntimeFeatures({
      mounts: [mountRuntimeFeature(module, { criticality: 'optional' })],
    });

    expect(composition.statuses()[0]).toMatchObject({
      status: 'failed',
      diagnostic: { code: 'ACTIVATION_FAILED' },
    });
  });
});

function feature(id: string) {
  return defineFeatureDefinition({ id, version: '1.0.0' });
}

function statusMap(statuses: readonly { featureId: FeatureId; status: string }[]) {
  return Object.fromEntries(statuses.map(({ featureId, status }) => [featureId, status]));
}

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
    throw new Error('Expected operation to fail.');
  } catch (error) {
    return error;
  }
}

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture value to be captured.');
  return value;
}
