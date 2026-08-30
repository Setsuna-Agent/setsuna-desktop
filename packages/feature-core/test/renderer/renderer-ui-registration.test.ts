import {
  defineListRendererSlot,
  defineRendererDependencies,
  defineRendererFeature,
  defineRendererFeatureHost,
  type RendererUiRegistrar,
} from '../../src/renderer/index.js';
import { defineFeature } from '../../src/definition.js';
import type { Disposer } from '../../src/scope.js';
import { describe, expect, it } from 'vitest';

const fixtureSlot = defineListRendererSlot<Record<string, never>>({
  id: 'renderer.fixture.feature-scope',
  scope: 'app',
});

describe('Renderer Feature UI registration', () => {
  it('binds UI disposers to the same Feature scope', async () => {
    const effects: string[] = [];
    const rendererFeature = defineRendererFeature({
      definition: defineFeature('renderer-ui-scope'),
      dependencies: defineRendererDependencies({}),
      setup({ ui }) {
        ui.list(fixtureSlot, {
          id: 'fixture.scoped-view',
          order: 0,
          render: () => null,
        });
      },
    });
    const { composition } = await defineRendererFeatureHost({
      required: [rendererFeature],
      optional: [],
    }).activate({
      createUiRegistrar: (_owner, track) => registrar(effects, track),
      hostMessages: { 'en-US': {} },
    });

    expect(effects).toEqual(['register:fixture.scoped-view']);
    await composition.dispose();
    expect(effects).toEqual(['register:fixture.scoped-view', 'dispose:fixture.scoped-view']);
  });

  it('rolls an optional Feature UI registration back when later setup fails', async () => {
    const effects: string[] = [];
    const rendererFeature = defineRendererFeature({
      definition: defineFeature('renderer-ui-rollback'),
      dependencies: defineRendererDependencies({}),
      setup({ ui }) {
        ui.list(fixtureSlot, {
          id: 'fixture.rollback-view',
          order: 0,
          render: () => null,
        });
        throw new Error('fixture setup failed');
      },
    });
    const { composition } = await defineRendererFeatureHost({
      required: [],
      optional: [rendererFeature],
    }).activate({
      createUiRegistrar: (_owner, track) => registrar(effects, track),
      hostMessages: { 'en-US': {} },
    });

    expect(composition.statuses()).toMatchObject([{
      featureId: 'renderer-ui-rollback',
      status: 'failed',
    }]);
    expect(effects).toEqual(['register:fixture.rollback-view', 'dispose:fixture.rollback-view']);
    await composition.dispose();
  });
});

function registrar(
  effects: string[],
  track: (disposer: Disposer) => void,
): RendererUiRegistrar {
  const register = (entry: { id: string }): Disposer => {
    effects.push(`register:${entry.id}`);
    let active = true;
    const disposer = () => {
      if (!active) return;
      active = false;
      effects.push(`dispose:${entry.id}`);
    };
    track(disposer);
    return disposer;
  };
  return {
    owner: Object.freeze({ pluginId: 'core.fixture', scopeId: 'fixture' }),
    single: (_slot, entry) => register(entry),
    list: (_slot, entry) => register(entry),
    keyed: (_slot, entry) => register(entry),
    chain: (_slot, entry) => register(entry),
  };
}
