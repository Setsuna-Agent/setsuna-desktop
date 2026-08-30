import type { RendererOwnedSlotRenderer } from '@setsuna-desktop/feature-core/renderer';
import { chatToolResultResolverSlot } from '@setsuna-desktop/renderer-contracts/chat';
import { createElement, type ReactNode } from 'react';
import {
  RendererKernelProvider,
  RendererOwnedSlotsProvider,
} from '../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../src/kernel/renderer-plugins/runtime.js';

const runtime = createRendererPluginRuntime();
runtime.declareRoot(
  Object.freeze({ pluginId: 'core.test-host', scopeId: 'test:kernel' }),
  Object.freeze({
    slot: chatToolResultResolverSlot,
    fallback: Object.freeze({ resolve: () => null }),
  }),
);
runtime.commitInitial();

const ownedSlots: RendererOwnedSlotRenderer = Object.freeze({
  chain: () => null as never,
  keyed: () => null,
  keyedEntries: () => Object.freeze([]),
  list: () => null,
  single: () => null,
});

/** Supplies the minimal committed Kernel graph needed by isolated leaf-component tests. */
export function RendererPluginTestHost({
  children,
  slots = ownedSlots,
}: Readonly<{
  children: ReactNode;
  slots?: RendererOwnedSlotRenderer;
}>) {
  return (
    <RendererKernelProvider runtime={runtime}>
      <RendererOwnedSlotsProvider slots={slots}>
        {children}
      </RendererOwnedSlotsProvider>
    </RendererKernelProvider>
  );
}

export function withRendererPluginTestHost(children: ReactNode): ReactNode {
  return createElement(RendererPluginTestHost, { children });
}
