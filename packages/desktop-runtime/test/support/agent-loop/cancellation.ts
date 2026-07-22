import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext, type ToolHost, type ToolRuntimeProfile } from '../../../src/ports/tool-host.js';

import {
  waitForModelRequestCount
} from './shared.js';

export class NonWaitingCancellationToolHost implements ToolHost {
  private markStarted: () => void = () => undefined;
  private releaseTool: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  readonly done = new Promise<void>((resolve) => {
    this.releaseTool = resolve;
  });

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'background_tool',
        description: 'A runtime-managed background tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ];
  }

  toolRuntimeProfile(_name: string, _context: ToolExecutionContext): ToolRuntimeProfile {
    return { waitsForRuntimeCancellation: false };
  }

  async runTool() {
    this.markStarted();
    await this.done;
    return { content: 'background tool finished' };
  }

  release(): void {
    this.releaseTool();
  }
}

export class NonCooperativeCancellationModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  aborted = false;
  private abortListenerReadyResolve: () => void = () => undefined;
  private readonly abortListenerReady = new Promise<void>((resolve) => {
    this.abortListenerReadyResolve = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    request.signal?.addEventListener('abort', () => {
      this.aborted = true;
    }, { once: true });
    this.abortListenerReadyResolve();
    yield { type: 'text_delta', text: 'partial response' };
    await new Promise<never>(() => undefined);
  }

  async waitUntilAbortListenerReady(): Promise<void> {
    await this.abortListenerReady;
  }
}

export async function waitForModelRequest(modelClient: { requests: ModelRequest[] }) {
  await waitForModelRequestCount(modelClient, 1);
}