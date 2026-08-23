import { defineFeatureDefinition } from '../../src/definition.js';
import {
  createPreloadBridgeBuilder,
  definePreloadFeature,
} from '../../src/preload/index.js';
import { describe, expect, it } from 'vitest';

type TestBridge = Readonly<{
  host: Readonly<{ ping(): string }>;
  sample: Readonly<{ read(): number }>;
}>;

const sampleFeature = definePreloadFeature<Pick<TestBridge, 'sample'>>({
  definition: defineFeatureDefinition({ id: 'sample', version: '1.0.0' }),
  bridgeKeys: ['sample'],
  contribute(writer) {
    writer.set('sample', Object.freeze({ read: () => 42 }));
  },
});

describe('PreloadBridgeBuilder', () => {
  it('assembles host and Feature-owned typed subobjects', () => {
    const builder = createPreloadBridgeBuilder<TestBridge>(['host', 'sample']);
    builder.addHost({ host: Object.freeze({ ping: () => 'pong' }) });
    builder.addFeature(sampleFeature);

    const bridge = builder.build();
    expect(bridge.host.ping()).toBe('pong');
    expect(bridge.sample.read()).toBe(42);
    expect(Object.isFrozen(bridge)).toBe(true);
  });

  it('fails before exposure when an implementation is missing or duplicated', () => {
    const missing = createPreloadBridgeBuilder<TestBridge>(['host', 'sample']);
    missing.addHost({ host: Object.freeze({ ping: () => 'pong' }) });
    expect(() => missing.build()).toThrow('missing required key(s): sample');

    const duplicate = createPreloadBridgeBuilder<TestBridge>(['host', 'sample']);
    duplicate.addFeature(sampleFeature);
    expect(() => duplicate.addFeature(sampleFeature)).toThrow('composed more than once');
  });
});
