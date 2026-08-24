import { defineFeature } from '../../src/definition.js';
import {
  definePreloadFeature,
  definePreloadFeatureHost,
} from '../../src/preload/index.js';
import { FeatureCompositionValidationError } from '../../src/status.js';
import { describe, expect, it } from 'vitest';

type TestBridge = Readonly<{
  host: Readonly<{ ping(): string }>;
  sample: Readonly<{ read(): number }>;
}>;

const sampleFeature = definePreloadFeature<Pick<TestBridge, 'sample'>>({
  definition: defineFeature('sample'),
  bridgeKeys: ['sample'],
  contribute(writer) {
    writer.set('sample', Object.freeze({ read: () => 42 }));
  },
});

describe('Preload Feature host', () => {
  it('assembles host and Feature-owned typed subobjects', () => {
    const host = definePreloadFeatureHost<TestBridge>({
      bridgeKeys: ['host', 'sample'],
      features: [sampleFeature],
    });
    const bridge = host.compose({ host: Object.freeze({ ping: () => 'pong' }) });
    expect(bridge.host.ping()).toBe('pong');
    expect(bridge.sample.read()).toBe(42);
    expect(Object.isFrozen(bridge)).toBe(true);
  });

  it('fails before exposure when an implementation is missing or duplicated', () => {
    const missing = definePreloadFeatureHost<TestBridge>({
      bridgeKeys: ['host', 'sample'],
      features: [],
    });
    const missingError = captureError(
      () => missing.compose({ host: Object.freeze({ ping: () => 'pong' }) }),
    );
    expect(missingError).toBeInstanceOf(FeatureCompositionValidationError);
    expect((missingError as FeatureCompositionValidationError).issues).toMatchObject([{
      code: 'INVALID_PRELOAD_BRIDGE',
    }]);

    const duplicate = definePreloadFeatureHost<TestBridge>({
      bridgeKeys: ['host', 'sample'],
      features: [sampleFeature, sampleFeature],
    });
    const duplicateError = captureError(
      () => duplicate.compose({ host: Object.freeze({ ping: () => 'pong' }) }),
    );
    expect(duplicateError).toBeInstanceOf(FeatureCompositionValidationError);
    expect((duplicateError as FeatureCompositionValidationError).issues).toMatchObject([{
      code: 'DUPLICATE_FEATURE_ID',
      featureIds: ['sample'],
    }]);
  });
});

function captureError(run: () => unknown): unknown {
  try {
    run();
    throw new Error('Expected fixture to fail.');
  } catch (error) {
    return error;
  }
}
