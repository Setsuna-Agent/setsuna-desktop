import { Children, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeGeneratedMessageAttachment } from '@setsuna-desktop/contracts';
import { ChatMessageImageGallery } from './ChatMessageImageGallery.js';

const hookHarness = vi.hoisted(() => {
  type Effect = {
    cleanup?: () => void;
    create: () => void | (() => void);
    dependencies?: readonly unknown[];
    pending: boolean;
  };

  let cursor = 0;
  let effects: Array<Effect | undefined> = [];
  let refs: Array<{ current: unknown } | undefined> = [];
  let states: unknown[] = [];

  return {
    beginRender() {
      cursor = 0;
    },
    flushEffects() {
      for (const effect of effects) {
        if (!effect?.pending) continue;
        effect.cleanup?.();
        effect.cleanup = effect.create() ?? undefined;
        effect.pending = false;
      }
    },
    refAt(index: number) {
      const ref = refs[index];
      if (!ref) throw new Error(`Missing hook ref at index ${index}`);
      return ref;
    },
    reset() {
      cursor = 0;
      effects = [];
      refs = [];
      states = [];
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.();
      effects = [];
    },
    useEffect(create: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++;
      const previous = effects[index];
      const changed = !previous
        || !dependencies
        || !previous.dependencies
        || dependencies.length !== previous.dependencies.length
        || dependencies.some((dependency, dependencyIndex) => !Object.is(dependency, previous.dependencies?.[dependencyIndex]));
      effects[index] = {
        ...previous,
        create,
        dependencies,
        pending: previous?.pending === true || changed,
      };
    },
    useRef(initialValue: unknown) {
      const index = cursor++;
      refs[index] ??= { current: initialValue };
      return refs[index];
    },
    useState(initialValue: unknown) {
      const index = cursor++;
      if (!(index in states)) {
        states[index] = typeof initialValue === 'function'
          ? (initialValue as () => unknown)()
          : initialValue;
      }
      return [
        states[index],
        (nextValue: unknown) => {
          states[index] = typeof nextValue === 'function'
            ? (nextValue as (previous: unknown) => unknown)(states[index])
            : nextValue;
        },
      ];
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: hookHarness.useEffect,
    useRef: hookHarness.useRef,
    useState: hookHarness.useState,
  };
});

const generatedAttachment: RuntimeGeneratedMessageAttachment = {
  id: 'generated_1',
  source: 'generated',
  assetId: 'generated_image_asset_1',
  name: 'generated-1.png',
  type: 'image/png',
  size: 3,
  modelVisible: false,
};

describe('ChatMessageImageGallery generated image lifecycle', () => {
  afterEach(() => {
    hookHarness.unmount();
    hookHarness.reset();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads only while near the viewport and revokes each loaded object URL', async () => {
    const readImageAsset = vi.fn().mockResolvedValue({
      ok: true as const,
      data: new Uint8Array([1, 2, 3]),
      type: 'image/png',
    });
    const createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:generated-1')
      .mockReturnValueOnce('blob:generated-2');
    const revokeObjectURL = vi.fn();
    const viewport = installGeneratedImageEnvironment({ createObjectURL, readImageAsset, revokeObjectURL });
    const image = mountGeneratedImage();

    expect(readImageAsset).not.toHaveBeenCalled();
    expect(viewport.observe).toHaveBeenCalledTimes(1);

    viewport.setIntersecting(true);
    image.rerender();
    hookHarness.flushEffects();
    await settlePromiseCallbacks();

    expect(readImageAsset).toHaveBeenCalledTimes(1);
    expect(readImageAsset).toHaveBeenLastCalledWith(generatedAttachment.assetId);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    image.rerender();
    hookHarness.flushEffects();
    expect(readImageAsset).toHaveBeenCalledTimes(1);

    viewport.setIntersecting(false);
    image.rerender();
    hookHarness.flushEffects();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:generated-1');
    const reservedFrame = image.rerender().props.children as ReactElement<{
      className: string;
      style?: { aspectRatio?: number };
    }>;
    expect(reservedFrame.props.className).toContain('chat-message-image--reserved');
    expect(reservedFrame.props.style?.aspectRatio).toBe(1.5);

    viewport.setIntersecting(true);
    image.rerender();
    hookHarness.flushEffects();
    await settlePromiseCallbacks();

    expect(readImageAsset).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    hookHarness.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:generated-2');
    expect(viewport.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not create an object URL when an asset read settles after unmount', async () => {
    let resolveRead!: (result: { ok: true; data: Uint8Array; type: string }) => void;
    const readImageAsset = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    const createObjectURL = vi.fn().mockReturnValue('blob:late');
    const revokeObjectURL = vi.fn();
    const viewport = installGeneratedImageEnvironment({ createObjectURL, readImageAsset, revokeObjectURL });
    const image = mountGeneratedImage();

    viewport.setIntersecting(true);
    image.rerender();
    hookHarness.flushEffects();
    expect(readImageAsset).toHaveBeenCalledTimes(1);

    hookHarness.unmount();
    resolveRead({ ok: true, data: new Uint8Array([1, 2, 3]), type: 'image/png' });
    await settlePromiseCallbacks();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(viewport.disconnect).toHaveBeenCalledTimes(1);
  });
});

function mountGeneratedImage(): { rerender: () => ReactElement } {
  const imageComponent = extractImageComponent();
  hookHarness.reset();
  const rerender = () => {
    hookHarness.beginRender();
    return imageComponent({ attachment: generatedAttachment, onAction: vi.fn() });
  };
  rerender();
  hookHarness.refAt(0).current = {
    nodeName: 'DIV',
    getBoundingClientRect: () => ({ height: 240, width: 360 }),
  };
  hookHarness.flushEffects();
  return { rerender };
}

function extractImageComponent(): (props: {
  attachment: RuntimeGeneratedMessageAttachment;
  onAction: (action: 'copy' | 'reveal') => void;
}) => ReactElement {
  hookHarness.beginRender();
  const shell = ChatMessageImageGallery({
    attachments: [generatedAttachment],
    variant: 'assistant',
  }) as ReactElement<{ children: ReactNode }>;
  const previewGroup = Children.toArray(shell.props.children)[0] as ReactElement<{ children: ReactElement<{ children: ReactNode }> }>;
  const image = Children.toArray(previewGroup.props.children.props.children)[0] as ReactElement;
  if (typeof image.type !== 'function') throw new Error('Expected gallery image to be a function component');
  return image.type as ReturnType<typeof extractImageComponent>;
}

function installGeneratedImageEnvironment({
  createObjectURL,
  readImageAsset,
  revokeObjectURL,
}: {
  createObjectURL: ReturnType<typeof vi.fn>;
  readImageAsset: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
}): {
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  setIntersecting: (isIntersecting: boolean) => void;
} {
  let notifyIntersection: ((isIntersecting: boolean) => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();

  class TestIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      notifyIntersection = (isIntersecting) => callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }

    observe = observe;
    disconnect = disconnect;
  }

  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('window', {
    setsunaDesktop: {
      desktop: { readImageAsset },
    },
  });

  return {
    disconnect,
    observe,
    setIntersecting(isIntersecting) {
      if (!notifyIntersection) throw new Error('Intersection observer was not installed');
      notifyIntersection(isIntersecting);
    },
  };
}

async function settlePromiseCallbacks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
