import {
  declareRendererChildSlot,
  defineChainRendererSlot,
  defineKeyedRendererSlot,
  defineListRendererSlot,
  defineRendererPlugin,
  defineSingleRendererSlot,
  type RendererPluginOwner,
} from '@setsuna-desktop/feature-core/renderer';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it } from 'vitest';
import {
  createRendererPluginRuntime,
  RendererSlotValidationError,
} from '../../../../src/kernel/renderer-plugins/runtime.js';

const kernelOwner = owner('core.renderer-kernel', 'kernel:0');
const shellOwner = owner('core.app-shell', 'host:app-shell');
const featureOwner = owner('feature.fixture', 'renderer:fixture:0');

describe('Renderer Plugin Runtime', () => {
  it('resolves owner-bound descendants and makes the old subtree dormant when its parent is replaced', async () => {
    const rootSlot = defineSingleRendererSlot<{ label: string }>({
      id: 'renderer.fixture.root',
      scope: 'app',
    });
    const actionsSlot = defineListRendererSlot<{ label: string }>({
      id: 'renderer.fixture.actions',
      scope: 'app',
    });
    const detailSlot = defineSingleRendererSlot<{ threadId: string }>({
      id: 'renderer.fixture.detail',
      scope: 'thread',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, {
      slot: rootSlot,
      required: true,
    });
    const shell = runtime.createRegistrar(shellOwner);
    shell.single(rootSlot, {
      id: 'core.app-shell.default',
      children: [declareRendererChildSlot(actionsSlot)],
      render: () => null,
    });
    const feature = runtime.createRegistrar(featureOwner);
    feature.list(actionsSlot, {
      id: 'fixture.primary-action',
      order: 10,
      children: [declareRendererChildSlot(detailSlot)],
      render: () => null,
    });
    feature.single(detailSlot, {
      id: 'fixture.detail',
      render: () => null,
    });

    let snapshot = runtime.commitInitial();
    const root = snapshot.resolveSingle(rootSlot).entries[0];
    const action = snapshot.resolveList(actionsSlot, root).entries[0];
    expect(snapshot.resolveSingle(detailSlot, action).entries[0]?.entryId).toBe('fixture.detail');
    expect(() => snapshot.resolveList(actionsSlot)).toThrow('not declared as a root');
    expect(snapshot.inspect().dormant).toEqual([]);

    const disposeOverride = await runtime.mount(defineRendererPlugin({
      id: 'core.fixture-compact-shell',
      activate({ ui }) {
        ui.single(rootSlot, {
          id: 'core.app-shell.compact',
          priority: 10,
          render: () => null,
        });
      },
    }));
    snapshot = runtime.getSnapshot();
    expect(snapshot.resolveSingle(rootSlot).entries[0]?.entryId).toBe('core.app-shell.compact');
    expect(snapshot.inspect().dormant.map(({ entryId }) => entryId)).toEqual([
      'fixture.detail',
      'fixture.primary-action',
    ]);

    await disposeOverride();
    await disposeOverride();
    snapshot = runtime.getSnapshot();
    expect(snapshot.resolveSingle(rootSlot).entries[0]?.entryId).toBe('core.app-shell.default');
    expect(snapshot.inspect().dormant).toEqual([]);
    await runtime.dispose();
  });

  it('keeps dependent contributions dormant while their declaring parent is unmounted', async () => {
    const rootSlot = defineSingleRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.dynamic-parent',
      scope: 'app',
    });
    const childSlot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.dynamic-child',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot: rootSlot });
    runtime.commitInitial();

    const parentPlugin = defineRendererPlugin({
      id: 'feature.dynamic-parent',
      activate({ ui }) {
        ui.single(rootSlot, {
          id: 'fixture.dynamic-parent',
          children: [declareRendererChildSlot(childSlot)],
          render: () => null,
        });
      },
    });
    const disposeParent = await runtime.mount(parentPlugin);
    const disposeChild = await runtime.mount(defineRendererPlugin({
      id: 'feature.dynamic-child',
      activate({ ui }) {
        ui.list(childSlot, {
          id: 'fixture.dynamic-child',
          order: 0,
          render: () => null,
        });
      },
    }));

    let snapshot = runtime.getSnapshot();
    let parent = snapshot.resolveSingle(rootSlot).entries[0];
    expect(snapshot.resolveList(childSlot, parent).entries).toHaveLength(1);

    await expect(disposeParent()).resolves.toBeUndefined();
    snapshot = runtime.getSnapshot();
    expect(snapshot.resolveSingle(rootSlot).entries).toEqual([]);
    expect(snapshot.inspect().dormant).toEqual([
      expect.objectContaining({
        entryId: 'fixture.dynamic-child',
        slotId: childSlot.id,
        state: 'dormant',
      }),
    ]);

    const disposeRemountedParent = await runtime.mount(parentPlugin);
    snapshot = runtime.getSnapshot();
    parent = snapshot.resolveSingle(rootSlot).entries[0];
    expect(snapshot.resolveList(childSlot, parent).entries).toHaveLength(1);

    await disposeChild();
    await disposeRemountedParent();
    await runtime.dispose();
  });

  it('keeps the previous snapshot when a ready mutation creates an ambiguous winner', async () => {
    const slot = defineSingleRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.atomic',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot, required: true });
    const registrar = runtime.createRegistrar(shellOwner);
    registrar.single(slot, {
      id: 'core.app-shell.first',
      render: () => null,
    });
    const initial = runtime.commitInitial();

    await expect(runtime.mount(defineRendererPlugin({
      id: 'core.fixture-ambiguous-shell',
      activate({ ui }) {
        ui.single(slot, {
          id: 'core.app-shell.second',
          render: () => null,
        });
      },
    }))).rejects.toBeInstanceOf(RendererSlotValidationError);
    expect(runtime.getSnapshot()).toBe(initial);
    expect(runtime.getSnapshot().resolveSingle(slot).entries.map(({ entryId }) => entryId)).toEqual([
      'core.app-shell.first',
    ]);
    await runtime.dispose();
  });

  it('validates every required key instead of accepting any keyed contribution', async () => {
    const slot = defineKeyedRendererSlot<'chat' | 'settings', Record<string, never>>({
      id: 'renderer.fixture.required-routes',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, {
      slot,
      requiredKeys: ['chat', 'settings'],
    });
    runtime.createRegistrar(shellOwner).keyed(slot, {
      id: 'fixture.chat-route',
      key: 'chat',
      render: () => null,
    });

    expect(() => runtime.commitInitial()).toThrow(RendererSlotValidationError);
    try {
      runtime.commitInitial();
    } catch (error) {
      expect((error as RendererSlotValidationError).issues).toContain(
        'Required keyed Slot "renderer.fixture.required-routes[settings]" has no contribution or fallback.',
      );
    }
    expect(runtime.state).toBe('collecting');
    await runtime.dispose();
  });

  it('replaces one dynamic Plugin atomically and keeps its previous mount when activation fails', async () => {
    const slot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.dynamic-replacement',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot });
    runtime.commitInitial();
    const firstDisposer = await runtime.mount(defineRendererPlugin({
      id: 'feature.dynamic-plugin',
      activate({ ui }) {
        ui.list(slot, { id: 'fixture.dynamic-entry', order: 0, render: () => null });
      },
    }));

    await expect(runtime.mount(defineRendererPlugin({
      id: 'feature.dynamic-plugin',
      activate() {
        throw new Error('replacement failed');
      },
    }))).rejects.toThrow('replacement failed');
    expect(runtime.getSnapshot().resolveList(slot).entries.map(({ entryId }) => entryId)).toEqual([
      'fixture.dynamic-entry',
    ]);

    const replacementDisposer = await runtime.mount(defineRendererPlugin({
      id: 'feature.dynamic-plugin',
      activate({ ui }) {
        ui.list(slot, { id: 'fixture.dynamic-entry', order: 0, render: () => null });
      },
    }));
    await firstDisposer();
    expect(runtime.getSnapshot().resolveList(slot).entries).toHaveLength(1);
    await replacementDisposer();
    expect(runtime.getSnapshot().resolveList(slot).entries).toEqual([]);
    await runtime.dispose();
  });

  it('keeps dynamic entry disposers effective after commit and stale-safe across replacement', async () => {
    const slot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.dynamic-entry-disposer',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot });
    runtime.commitInitial();
    let staleEntryDisposer!: Disposer;
    const staleMountDisposer = await runtime.mount(defineRendererPlugin({
      id: 'feature.dynamic-entry-disposer',
      activate({ ui }) {
        staleEntryDisposer = ui.list(slot, {
          id: 'fixture.dynamic-disposable-entry',
          order: 0,
          render: () => null,
        });
      },
    }));
    let currentEntryDisposer!: Disposer;
    const currentMountDisposer = await runtime.mount(defineRendererPlugin({
      id: 'feature.dynamic-entry-disposer',
      activate({ ui }) {
        currentEntryDisposer = ui.list(slot, {
          id: 'fixture.dynamic-disposable-entry',
          order: 0,
          render: () => null,
        });
      },
    }));

    await staleEntryDisposer();
    expect(runtime.getSnapshot().resolveList(slot).entries).toHaveLength(1);
    await currentEntryDisposer();
    expect(runtime.getSnapshot().resolveList(slot).entries).toEqual([]);

    await staleMountDisposer();
    await currentMountDisposer();
    await runtime.dispose();
  });

  it('selects list, keyed, and chain entries with stable semantics', async () => {
    const listSlot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.list',
      scope: 'app',
    });
    const keyedSlot = defineKeyedRendererSlot<'settings' | 'chat', Record<string, never>>({
      id: 'renderer.fixture.route',
      scope: 'app',
    });
    const chainSlot = defineChainRendererSlot<number, string>({
      id: 'renderer.fixture.chain',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot: listSlot });
    runtime.declareRoot(kernelOwner, { slot: keyedSlot });
    runtime.declareRoot(kernelOwner, {
      slot: chainSlot,
      fallback: { resolve: () => 'fallback' },
    });
    const registrar = runtime.createRegistrar(featureOwner);
    registrar.list(listSlot, { id: 'fixture.later', order: 20, render: () => null });
    registrar.list(listSlot, { id: 'fixture.earlier', order: 10, render: () => null });
    registrar.keyed(keyedSlot, {
      id: 'fixture.settings-default',
      key: 'settings',
      render: () => null,
    });
    registrar.keyed(keyedSlot, {
      id: 'fixture.settings-override',
      key: 'settings',
      priority: 10,
      render: () => null,
    });
    registrar.chain(chainSlot, {
      id: 'fixture.positive',
      priority: 10,
      select: (value) => value > 0 ? 'positive' : null,
    });
    registrar.chain(chainSlot, {
      id: 'fixture.zero',
      select: (value) => value === 0 ? 'zero' : null,
    });

    const snapshot = runtime.commitInitial();
    expect(snapshot.resolveList(listSlot).entries.map(({ entryId }) => entryId)).toEqual([
      'fixture.earlier',
      'fixture.later',
    ]);
    expect(snapshot.resolveKeyed(keyedSlot, 'settings').entries[0]?.entryId).toBe(
      'fixture.settings-override',
    );
    expect(snapshot.resolveKeyed(keyedSlot, 'chat').entries).toEqual([]);
    expect(snapshot.resolveChain(chainSlot, 1)).toBe('positive');
    expect(snapshot.resolveChain(chainSlot, 0)).toBe('zero');
    expect(snapshot.resolveChain(chainSlot, -1)).toBe('fallback');
    await runtime.dispose();
  });

  it('applies layout preferences transactionally and reports stale identities', async () => {
    const singleSlot = defineSingleRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.preferred-single',
      scope: 'app',
      userConfigurable: true,
    });
    const keyedSlot = defineKeyedRendererSlot<'route', Record<string, never>>({
      id: 'renderer.fixture.preferred-keyed',
      scope: 'app',
      userConfigurable: true,
    });
    const listSlot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.preferred-list',
      scope: 'app',
      userConfigurable: true,
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot: singleSlot, required: true });
    runtime.declareRoot(kernelOwner, { slot: keyedSlot, required: true });
    runtime.declareRoot(kernelOwner, { slot: listSlot });
    const registrar = runtime.createRegistrar(featureOwner);
    registrar.single(singleSlot, { id: 'fixture.single-default', priority: 10, render: () => null });
    registrar.single(singleSlot, { id: 'fixture.single-alternative', render: () => null });
    registrar.keyed(keyedSlot, { id: 'fixture.keyed-default', key: 'route', priority: 10, render: () => null });
    registrar.keyed(keyedSlot, { id: 'fixture.keyed-alternative', key: 'route', render: () => null });
    registrar.list(listSlot, { id: 'fixture.list-first', order: 10, render: () => null });
    registrar.list(listSlot, { id: 'fixture.list-second', order: 20, render: () => null });
    runtime.commitInitial();

    const preferred = await runtime.updatePreferences({
      schemaVersion: 1,
      singleSelections: {
        [singleSlot.id]: 'fixture.single-alternative',
        'renderer.fixture.missing-slot': 'fixture.missing',
      },
      keyedSelections: {
        [keyedSlot.id]: { route: 'fixture.keyed-alternative' },
      },
      listPreferences: {
        [listSlot.id]: {
          hiddenEntryIds: ['fixture.list-first'],
          order: ['fixture.list-second', 'fixture.stale-list-entry'],
        },
      },
    });

    expect(preferred.resolveSingle(singleSlot).entries[0]?.entryId).toBe('fixture.single-alternative');
    expect(preferred.resolveKeyed(keyedSlot, 'route').entries[0]?.entryId).toBe('fixture.keyed-alternative');
    expect(preferred.resolveList(listSlot).entries.map(({ entryId }) => entryId)).toEqual([
      'fixture.list-second',
    ]);
    expect(preferred.inspect().stalePreferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'slot-missing', slotId: 'renderer.fixture.missing-slot' }),
      expect.objectContaining({ entryId: 'fixture.stale-list-entry', reason: 'entry-missing' }),
    ]));

    const lastGoodSnapshot = runtime.getSnapshot();
    await expect(runtime.updatePreferences({ schemaVersion: 2 } as never)).rejects.toThrow(
      'Unsupported layout preference schemaVersion',
    );
    expect(runtime.getSnapshot()).toBe(lastGoodSnapshot);
    await runtime.dispose();
  });

  it('rejects unreachable contributions, scope inversions, and declaration cycles before ready', async () => {
    const rootSlot = defineSingleRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.validation-root',
      scope: 'thread',
    });
    const childSlot = defineSingleRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.validation-child',
      scope: 'app',
    });
    const orphanSlot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.orphan',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot: rootSlot, required: true });
    const registrar = runtime.createRegistrar(featureOwner);
    registrar.single(rootSlot, {
      id: 'fixture.validation-root',
      children: [declareRendererChildSlot(childSlot)],
      render: () => null,
    });
    registrar.single(childSlot, {
      id: 'fixture.validation-child',
      children: [declareRendererChildSlot(rootSlot)],
      render: () => null,
    });
    registrar.list(orphanSlot, {
      id: 'fixture.orphan',
      order: 0,
      render: () => null,
    });

    expect(() => runtime.commitInitial()).toThrow(RendererSlotValidationError);
    try {
      runtime.commitInitial();
    } catch (error) {
      expect((error as RendererSlotValidationError).issues.join('\n')).toContain('no root or parent');
      expect((error as RendererSlotValidationError).issues.join('\n')).toContain('cannot own broader child');
      expect((error as RendererSlotValidationError).issues.join('\n')).toContain('declaration cycle');
    }
    expect(runtime.state).toBe('collecting');
    await runtime.dispose();
  });

  it('tracks registration disposal in the owner scope and ignores stale disposers during shutdown', async () => {
    const slot = defineListRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.scope',
      scope: 'app',
    });
    const tracked: Array<() => void | PromiseLike<void>> = [];
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(kernelOwner, { slot });
    const registrar = runtime.createRegistrar(featureOwner, (disposer) => tracked.push(disposer));
    registrar.list(slot, { id: 'fixture.scoped', order: 0, render: () => null });
    runtime.commitInitial();
    expect(tracked).toHaveLength(1);

    await runtime.dispose();
    await tracked[0]();
    await tracked[0]();
    expect(runtime.state).toBe('disposed');
    expect(runtime.getSnapshot().inspect().roots).toEqual([]);
  });
});

function owner(pluginId: string, scopeId: string): RendererPluginOwner {
  return Object.freeze({ pluginId, scopeId });
}
