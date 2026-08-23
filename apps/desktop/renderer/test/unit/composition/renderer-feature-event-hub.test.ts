import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { describe, expect, it, vi } from 'vitest';
import { RendererFeatureEventHub } from '../../../src/composition/renderer-feature-event-hub.js';

describe('RendererFeatureEventHub', () => {
  it('reveals only the owning Feature payload while advancing every subscriber watermark', () => {
    const hub = new RendererFeatureEventHub();
    const goal = scope('goal');
    const image = scope('image-generation');
    const onGoal = vi.fn();
    const onImage = vi.fn();
    hub.subscribe(goal.scope, 'thread_1', onGoal);
    hub.subscribe(image.scope, 'thread_1', onImage);

    hub.accept({
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'feature.event',
      createdAt: '2026-08-22T00:00:00.000Z',
      featureId: goal.scope.owner.featureId,
      eventType: 'goal.changed',
      schemaVersion: 1,
      payload: { private: 'goal-only' },
    });
    hub.accept({
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-08-22T00:00:01.000Z',
      payload: { title: 'Core event' },
    });

    expect(onGoal.mock.calls.map(([item]) => item)).toEqual([
      expect.objectContaining({ kind: 'event', seq: 1 }),
      { kind: 'advance', seq: 2 },
    ]);
    expect(onImage.mock.calls.map(([item]) => item)).toEqual([
      { kind: 'advance', seq: 1 },
      { kind: 'advance', seq: 2 },
    ]);
    expect(onImage.mock.calls[0]?.[0]).not.toHaveProperty('event');
  });

  it('stops delivery when the owning scope is disposed', async () => {
    const hub = new RendererFeatureEventHub();
    const owner = scope('goal');
    const listener = vi.fn();
    hub.subscribe(owner.scope, 'thread_1', listener);

    await owner.finishDispose();
    hub.advance('thread_1', 8);

    expect(listener).not.toHaveBeenCalled();
  });

  it('releases its scope listener when a component subscription is disposed', () => {
    const hub = new RendererFeatureEventHub();
    const owner = scope('goal');
    const listener = vi.fn();
    const removeEventListener = vi.spyOn(owner.scope.signal, 'removeEventListener');
    const subscription = hub.subscribe(owner.scope, 'thread_1', listener);

    subscription.dispose();
    hub.advance('thread_1', 8);

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(listener).not.toHaveBeenCalled();
  });
});

function scope(id: string) {
  const definition = defineFeatureDefinition({ id, version: '1.0.0' });
  const controller = createFeatureScope({
    featureId: definition.id,
    process: 'renderer',
    scopeId: `${id}-test`,
  });
  controller.activate();
  return controller;
}
