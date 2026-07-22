import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeHookRun
} from '@setsuna-desktop/contracts';
import { tmpdir } from 'node:os';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext } from '../../../src/ports/tool-host.js';

import {
  testRuntimeEnvironment
} from './shared.js';

export class StopHookModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: this.requests.length === 1 ? 'first answer' : 'final answer' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export function hookContext(): ToolExecutionContext & { turnId: string } {
  return {
    threadId: 'thread_parent',
    turnId: 'turn_child',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    features: {},
    signal: new AbortController().signal,
  };
}

export function hookEnvironment() {
  return testRuntimeEnvironment('local', tmpdir());
}

export function hookEventCapture() {
  const started: RuntimeHookRun[] = [];
  const completed: RuntimeHookRun[] = [];
  return {
    started,
    completed,
    publishHookStarted: async (run: RuntimeHookRun) => {
      started.push(run);
    },
    publishHookCompleted: async (run: RuntimeHookRun) => {
      completed.push(run);
    },
  };
}