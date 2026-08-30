// @vitest-environment happy-dom

import {
  declareRendererChildSlot,
  defineListRendererSlot,
  defineSingleRendererSlot,
} from '@setsuna-desktop/feature-core/renderer';
import { fireEvent, render, screen } from '@testing-library/react';
import { Component, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RendererKernelProvider,
  RendererRootSingleSlot,
} from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';

describe('RendererKernelProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders owner-bound child Slots and contains a broken contribution at its entry boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rootSlot = defineSingleRendererSlot<{ title: string }>({
      id: 'renderer.fixture.react-root',
      scope: 'app',
    });
    const statusSlot = defineListRendererSlot<{ suffix: string }>({
      id: 'renderer.fixture.react-status',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(
      { pluginId: 'core.renderer-kernel', scopeId: 'kernel:0' },
      { slot: rootSlot, required: true },
    );
    const shell = runtime.createRegistrar({ pluginId: 'core.app-shell', scopeId: 'host:shell' });
    shell.single(rootSlot, {
      id: 'core.app-shell.default',
      children: [declareRendererChildSlot(statusSlot)],
      render: ({ title }, slots) => (
        <main>
          <h1>{title}</h1>
          {slots.list(statusSlot, { suffix: '!' })}
        </main>
      ),
    });
    const feature = runtime.createRegistrar({ pluginId: 'feature.fixture', scopeId: 'feature:0' });
    feature.list(statusSlot, {
      id: 'fixture.healthy-status',
      order: 10,
      render: ({ suffix }) => <span>healthy{suffix}</span>,
    });
    feature.list(statusSlot, {
      id: 'fixture.broken-status',
      order: 20,
      render: () => {
        throw new Error('broken fixture');
      },
      errorFallback: (error) => <span role="status">isolated: {error.message}</span>,
    });
    runtime.commitInitial();

    const rendered = render(
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot slot={rootSlot} props={{ title: 'Fixture shell' }} />
      </RendererKernelProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Fixture shell' })).toBeTruthy();
    expect(screen.getByText('healthy!')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('isolated: broken fixture');
    expect(runtime.getSnapshot().inspect().renderErrors).toEqual([
      expect.objectContaining({
        entryId: 'fixture.broken-status',
        errorName: 'Error',
        slotId: statusSlot.id,
      }),
    ]);
    expect(JSON.stringify(runtime.getSnapshot().inspect())).not.toContain('broken fixture');
    rendered.unmount();
    await runtime.dispose();
  });

  it('lets an unhandled single contribution error reach the application boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rootSlot = defineSingleRendererSlot<Record<string, never>>({
      id: 'renderer.fixture.unhandled-root',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(
      { pluginId: 'core.renderer-kernel', scopeId: 'kernel:0' },
      { slot: rootSlot, required: true },
    );
    runtime.createRegistrar({ pluginId: 'core.app-shell', scopeId: 'host:shell' }).single(
      rootSlot,
      {
        id: 'core.app-shell.default',
        render: () => {
          throw new Error('host surface failed');
        },
      },
    );
    runtime.commitInitial();

    const rendered = render(
      <TestApplicationBoundary>
        <RendererKernelProvider runtime={runtime}>
          <RendererRootSingleSlot slot={rootSlot} props={{}} />
        </RendererKernelProvider>
      </TestApplicationBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toBe('application: host surface failed');
    rendered.unmount();
    await runtime.dispose();
  });

  it('renders a declaration fallback from Slot props without exposing child outlets', async () => {
    const rootSlot = defineSingleRendererSlot<{ label: string }>({
      id: 'renderer.fixture.visual-fallback',
      scope: 'app',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(
      { pluginId: 'core.renderer-kernel', scopeId: 'kernel:0' },
      {
        slot: rootSlot,
        fallback: { render: ({ label }) => <span role="status">fallback: {label}</span> },
      },
    );
    runtime.commitInitial();

    const rendered = render(
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot slot={rootSlot} props={{ label: 'empty surface' }} />
      </RendererKernelProvider>,
    );

    expect(screen.getByRole('status').textContent).toBe('fallback: empty surface');
    rendered.unmount();
    await runtime.dispose();
  });

  it('remounts contribution state when a scoped Slot outlet changes instance', async () => {
    const threadSlot = defineSingleRendererSlot<{ label: string }>({
      id: 'renderer.fixture.thread-surface',
      scope: 'thread',
    });
    const runtime = createRendererPluginRuntime();
    runtime.declareRoot(
      { pluginId: 'core.renderer-kernel', scopeId: 'kernel:0' },
      { slot: threadSlot, required: true },
    );
    runtime.createRegistrar({ pluginId: 'feature.fixture', scopeId: 'feature:0' }).single(
      threadSlot,
      {
        id: 'fixture.thread-surface',
        render: ({ label }) => <StatefulSlotView label={label} />,
      },
    );
    runtime.commitInitial();

    const rendered = render(
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot
          instanceKey="thread-a:main"
          props={{ label: 'thread A' }}
          slot={threadSlot}
        />
      </RendererKernelProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'thread A: 0' }));
    expect(screen.getByRole('button', { name: 'thread A: 1' })).toBeTruthy();

    rendered.rerender(
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot
          instanceKey="thread-a:main"
          props={{ label: 'same instance' }}
          slot={threadSlot}
        />
      </RendererKernelProvider>,
    );
    expect(screen.getByRole('button', { name: 'same instance: 1' })).toBeTruthy();

    rendered.rerender(
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot
          instanceKey="thread-b:main"
          props={{ label: 'thread B' }}
          slot={threadSlot}
        />
      </RendererKernelProvider>,
    );
    expect(screen.getByRole('button', { name: 'thread B: 0' })).toBeTruthy();

    rendered.unmount();
    await runtime.dispose();
  });
});

function StatefulSlotView({ label }: Readonly<{ label: string }>) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {label}: {count}
    </button>
  );
}

class TestApplicationBoundary extends Component<
  Readonly<{ children: ReactNode }>,
  Readonly<{ error: Error | null }>
> {
  state = { error: null } as Readonly<{ error: Error | null }>;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error
      ? <div role="alert">application: {this.state.error.message}</div>
      : this.props.children;
  }
}
