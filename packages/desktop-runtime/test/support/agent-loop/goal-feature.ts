import { goalFeature, type GoalState } from '@setsuna-desktop/feature-goal/contracts';
import {
  createRuntimeGoalEventRegistry,
  RuntimeGoalCoordinator,
} from '@setsuna-desktop/feature-goal/runtime';
import { createFeatureProjectionStore } from '@setsuna-desktop/feature-core/runtime';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { onTestFinished } from 'vitest';
import { RuntimeFeatureEventRegistry } from '../../../src/features/events/runtime-feature-event-registry.js';
import { ThreadStoreEventReader } from '../../../src/features/events/thread-store-event-reader.js';
import { AgentLoop, type AgentLoopOptions } from '../../../src/loop/core/agent-loop.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';

/** Assembles the real Goal Feature data path for AgentLoop-focused tests. */
export function createGoalEnabledAgentLoop(options: AgentLoopOptions): AgentLoop {
  const eventWriter = options.eventWriter
    ?? new RuntimeEventWriter(options.threadStore, options.eventBus);
  const loop = new AgentLoop({ ...options, eventWriter });
  const eventDispatcher = new RuntimeFeatureEventRegistry();
  const registry = createRuntimeGoalEventRegistry();
  const projection = createFeatureProjectionStore<GoalState>({
    featureId: goalFeature.id,
    eventReader: new ThreadStoreEventReader(options.threadStore),
    initialState: () => Object.freeze({ goal: null }),
    reduce: (state, record) => registry.reduce(state, record),
  });
  const scope = createFeatureScope({
    featureId: goalFeature.id,
    process: 'runtime',
    scopeId: 'goal-agent-loop-test',
  });
  scope.scope.track(projection, (store) => store.dispose());
  eventDispatcher.registerProjection(scope.scope, projection);
  scope.scope.add(eventWriter.subscribePersisted((event) => eventDispatcher.accept(event)));
  const control = new RuntimeGoalCoordinator({
    host: loop.goalRuntimeHost(),
    projection,
  });
  scope.scope.add(() => control.shutdown());
  loop.bindGoalControl(control);
  scope.activate();
  onTestFinished(() => scope.finishDispose());
  return loop;
}
