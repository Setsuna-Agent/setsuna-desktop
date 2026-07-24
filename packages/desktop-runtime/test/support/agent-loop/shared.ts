import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
  RuntimeEnvironment,
  RuntimeExecPolicyAmendment,
  RuntimeMessage,
  RuntimeNetworkPolicyAmendment,
  RuntimeToolCall,
  RuntimeToolDefinition,
  RuntimeUsageRecord
} from '@setsuna-desktop/contracts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { type Clock } from '../../../src/ports/clock.js';
import type { ConfigStore, RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { PolicyAmendmentStore, RuntimePolicyAmendments } from '../../../src/ports/policy-amendment-store.js';
import type { SkillRegistry } from '../../../src/ports/skill-registry.js';
import type { ThreadStore } from '../../../src/ports/thread-store.js';
import { type ToolExecutionContext, type ToolHost, type ToolTurnCleanupOutcome } from '../../../src/ports/tool-host.js';
import type { UsageStore } from '../../../src/ports/usage-store.js';



export const isSlowTestPlatform = Boolean(process.env.CI) || process.platform === 'win32';

export const asyncWaitTimeoutMs = isSlowTestPlatform ? 5_000 : 2_000;

export const asyncWaitPollMs = 25;

export class ToolCallingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield {
        type: 'usage',
        usage: {
          provider: 'test-provider',
          model: 'test-model',
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
        },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'I read the file.' };
    yield {
      type: 'usage',
      usage: {
        provider: 'test-provider',
        model: 'test-model',
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class SingleToolCallModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly toolCall: RuntimeToolCall) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [this.toolCall],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'tool handled' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ToolDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '{' } };
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '"file_path":"src/generated.txt",' } };
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '"content":"generated\\n"}' } };
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_delta', name: 'write_file', arguments: '{"file_path":"src/generated.txt","content":"generated\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export const WORKSPACE_READ_FILE_TOOL: RuntimeToolDefinition = {
  name: 'workspace_read_file',
  description: 'Read a file',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

export class CapturingToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];
  cleanupCalls: Array<{ threadId: string; projectId?: string; turnId?: string; status: ToolTurnCleanupOutcome['status'] }> = [];

  constructor(private readonly tools: RuntimeToolDefinition[] = [WORKSPACE_READ_FILE_TOOL]) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return this.tools;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return { content: 'file contents from tool' };
  }

  cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome) {
    this.cleanupCalls.push({
      threadId: context.threadId,
      projectId: context.projectId,
      turnId: context.turnId,
      status: outcome.status,
    });
  }
}

export class PreviewingToolHost implements ToolHost {
  calls = 0;
  partialPreviewCalls: Array<{ name: string; hasProjectId: boolean }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
    ];
  }

  systemPrompt() {
    return 'PC local tool prompt';
  }

  async previewPartialToolCall(name: string, rawArguments: string, context: ToolExecutionContext) {
    this.partialPreviewCalls.push({ name, hasProjectId: Boolean(context.projectId) });
    if (!rawArguments.includes('src/generated.txt')) return null;
    return filePreview();
  }

  async previewToolCall() {
    return filePreview();
  }

  async runTool() {
    this.calls += 1;
    return { content: 'wrote file', preview: filePreview().resultPreview };
  }
}

export function filePreview() {
  return {
    argumentsPreview: JSON.stringify({ file_path: 'src/generated.txt' }),
    resultPreview: JSON.stringify({
      diff: {
        path: 'src/generated.txt',
        action: 'create',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', content: 'generated', newLine: 1 }],
      },
    }),
  };
}

export class MemoryCapturingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Remembered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class PassiveMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction' || request.model === 'memory-extract-model') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield {
        type: 'usage',
        usage: {
          provider: 'test-provider',
          model: 'selected-model',
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ApprovalToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      const historicalCallCount = request.messages.reduce(
        (count, message) => count + (message.toolCalls?.length ?? 0),
        0,
      );
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: `call_approval_${historicalCallCount + 1}`,
          name: 'dangerous_tool',
          arguments: '{"value":42}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The approved tool ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class EscalatedExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_escalated',
          name: 'exec_command',
          arguments: '{"cmd":"printf ok","sandbox_permissions":"require_escalated","justification":"needs unsandboxed access"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The escalated command ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class CancellableModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  aborted = false;
  private abortListenerReadyResolve: () => void = () => undefined;
  private readonly abortListenerReady = new Promise<void>((resolve) => {
    this.abortListenerReadyResolve = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    const abortWait = new Promise<void>((resolve) => {
      const signal = request.signal;
      if (!signal) {
        this.abortListenerReadyResolve();
        resolve();
        return;
      }
      if (signal.aborted) {
        this.aborted = true;
        this.abortListenerReadyResolve();
        resolve();
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          this.aborted = true;
          resolve();
        },
        { once: true },
      );
      this.abortListenerReadyResolve();
    });
    yield { type: 'text_delta', text: 'partial response' };
    await abortWait;
    request.signal?.throwIfAborted();
    yield { type: 'text_delta', text: ' should not appear' };
    yield { type: 'done', finishReason: 'stop' };
  }

  async waitUntilAbortListenerReady(): Promise<void> {
    await this.abortListenerReady;
  }
}

export class ApprovalToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown }> = [];

  constructor(private readonly options: { approvalKeys?: string[]; persistentApprovalKeys?: string[] } = {}) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'dangerous_tool',
        description: 'A tool requiring user approval',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    return name === 'dangerous_tool'
      ? {
        reason: 'This tool changes local state.',
        argumentsPreview: JSON.stringify(input),
        approvalKeys: this.options.approvalKeys,
        persistentApprovalKeys: this.options.persistentApprovalKeys,
      }
      : null;
  }

  async runTool(name: string, input: unknown) {
    this.calls.push({ name, input });
    return { content: 'approved result' };
  }
}

export class EscalatedExecToolHost implements ToolHost {
  attempts: string[] = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    const args = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    return name === 'exec_command' && args.sandbox_permissions === 'require_escalated'
      ? {
          reason: String(args.justification || 'requires escalated sandbox permissions'),
          argumentsPreview: JSON.stringify(input),
        }
      : null;
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push(context.sandbox?.mode ?? 'missing');
    return { content: 'ran escalated exec' };
  }
}

export class AdditionalPermissionsExecToolHost implements ToolHost {
  contexts: ToolExecutionContext[] = [];

  constructor(private readonly cwd = process.cwd()) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  environmentForToolContext(context: ToolExecutionContext) {
    return testRuntimeEnvironment(context.projectId ?? context.threadId, this.cwd);
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.contexts.push(context);
    return { content: 'ran with additional permissions' };
  }
}

export class CapturingUsageStore implements UsageStore {
  records: RuntimeUsageRecord[] = [];

  async recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord> {
    const record = { id: `usage_${this.records.length + 1}`, ...input };
    this.records.push(record);
    return record;
  }

  async getUsage() {
    return {
      records: this.records,
      summary: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        recordCount: this.records.length,
        byDay: [],
        byProvider: [],
        byModel: [],
      },
    };
  }
}

export class InMemoryPolicyAmendmentStore implements PolicyAmendmentStore {
  private readonly amendments: RuntimePolicyAmendments = {
    execPolicyAmendments: [],
    networkPolicyAmendments: [],
  };

  async listPolicyAmendments(): Promise<RuntimePolicyAmendments> {
    return {
      execPolicyAmendments: this.amendments.execPolicyAmendments.map((item) => [...item]),
      networkPolicyAmendments: this.amendments.networkPolicyAmendments.map((item) => ({ ...item })),
    };
  }

  async appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void> {
    this.amendments.execPolicyAmendments.push([...amendment]);
  }

  async appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment): Promise<void> {
    this.amendments.networkPolicyAmendments.push({ ...amendment });
  }
}

export class MutableClock implements Clock {
  private value: Date;

  constructor(iso: string) {
    this.value = new Date(iso);
  }

  now(): Date {
    return new Date(this.value);
  }

  set(iso: string): void {
    this.value = new Date(iso);
  }
}

export async function appendCompletedExchange(
  threadStore: ThreadStore,
  ids: RandomIdGenerator,
  clock: Clock,
  threadId: string,
  turnId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const userCreatedAt = clock.now().toISOString();
  await threadStore.appendEvent(threadId, {
    id: ids.id('event'),
    threadId,
    turnId,
    type: 'message.created',
    createdAt: userCreatedAt,
    payload: {
      message: {
        id: ids.id('msg'),
        turnId,
        role: 'user',
        content: userContent,
        createdAt: userCreatedAt,
        status: 'complete',
      },
    },
  });
  const assistantCreatedAt = clock.now().toISOString();
  const assistantMessageId = ids.id('msg');
  await threadStore.appendEvent(threadId, {
    id: ids.id('event'),
    threadId,
    turnId,
    type: 'message.created',
    createdAt: assistantCreatedAt,
    payload: {
      message: {
        id: assistantMessageId,
        turnId,
        role: 'assistant',
        content: assistantContent,
        createdAt: assistantCreatedAt,
        status: 'complete',
      },
    },
  });
  await threadStore.appendEvent(threadId, {
    id: ids.id('event'),
    threadId,
    turnId,
    type: 'message.completed',
    createdAt: assistantCreatedAt,
    payload: { messageId: assistantMessageId },
  });
}

export const hookScriptDir = mkdtempSync(path.join(tmpdir(), 'setsuna-agent-loop-hook-'));

export let hookScriptCounter = 0;

export function nodeEvalHook(script: string): string {
  const scriptPath = path.join(hookScriptDir, `hook-${hookScriptCounter}.cjs`);
  hookScriptCounter += 1;
  writeFileSync(scriptPath, script, 'utf8');
  return `node ${JSON.stringify(scriptPath)}`;
}

export class PersonalizationConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: 'Prefer crisp context before the answer.',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'daily' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

export class HooksConfigStore implements ConfigStore {
  constructor(private readonly hooks: RuntimeConfigState['hooks']) {}

  async getConfig(): Promise<RuntimeConfigState> {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
      hooks: this.hooks,
      bypassHookTrust: true,
    };
  }

  async saveConfig(): Promise<RuntimeConfigState> {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

export class ContextWindowConfigStore implements ConfigStore {
  constructor(private readonly contextWindowTokens: number) {}

  async getConfig(): Promise<RuntimeConfigState> {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [{
        id: 'test',
        name: 'Test provider',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.test/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: 'secret',
        models: [{
          id: 'local-runtime-smoke',
          name: 'Local runtime smoke',
          code: 'local-runtime-smoke',
          enabled: true,
          contextWindowTokens: this.contextWindowTokens,
          maxOutputTokens: 68_000,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
      }],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer',
      approvalPolicy: 'on-request',
      permissionProfile: 'workspace-write',
    };
  }

  async saveConfig(): Promise<RuntimeConfigState> {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const config = await this.getConfig();
    const provider = config.providers[0];
    return {
      ...provider,
      apiKey: 'secret',
      activeModel: provider.models[0],
    };
  }
}

export class MemorySettingsConfigStore implements ConfigStore {
  constructor(private readonly memory: RuntimeConfigState['memory']) {}

  async getConfig(): Promise<RuntimeConfigState> {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: this.memory,
      memoryEnabled: this.memory.useMemories || this.memory.generateMemories,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig(): Promise<RuntimeConfigState> {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

export class StrictApprovalConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'strict' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

export class ReadOnlyConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'read-only' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

export class FullApprovalConfigStore implements ConfigStore {
  constructor(
    private readonly permissionProfile: 'workspace-write' | 'danger-full-access' = 'workspace-write',
  ) {}

  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'full' as const,
      permissionProfile: this.permissionProfile,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

export async function mkDataDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  return mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-tools-'));
}

export async function waitForPendingApproval(approvalGate: InMemoryApprovalGate) {
  return approvalGate.waitForPendingApproval();
}

export async function waitForTestState<T>(
  probe: () => Promise<T> | T,
  isReady: (value: T) => boolean,
  failureMessage: (lastValue: T | undefined) => string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? asyncWaitTimeoutMs;
  const pollMs = options.pollMs ?? asyncWaitPollMs;
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;

  while (Date.now() <= deadline) {
    lastValue = await probe();
    if (isReady(lastValue)) return lastValue;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remainingMs)));
  }

  throw new Error(`${failureMessage(lastValue)} after ${timeoutMs}ms.`);
}

export async function waitForApprovalToolRun(
  threadStore: ThreadStore,
  threadId: string,
  approvalId: string,
  predicate: (run: NonNullable<RuntimeMessage['toolRuns']>[number]) => boolean = () => true,
) {
  return waitForTestState(
    async () => {
      const thread = await threadStore.getThread(threadId);
      return thread?.messages.flatMap((message) => message.toolRuns ?? []).find((item) => item.approvalId === approvalId);
    },
    (run) => Boolean(run && predicate(run)),
    (run) => `Timed out waiting for approval tool run ${approvalId}; last run=${JSON.stringify(run ?? null)}`,
  );
}

export async function waitForModelAbort(modelClient: { aborted: boolean }) {
  await waitForTestState(
    () => modelClient.aborted,
    (aborted) => aborted,
    (aborted) => `Timed out waiting for model abort; aborted=${String(aborted)}`,
  );
}

export async function waitForModelRequestCount(modelClient: { requests: ModelRequest[] }, count: number) {
  await waitForTestState(
    () => modelClient.requests.length,
    (requestCount) => requestCount >= count,
    (requestCount) => `Timed out waiting for ${count} model request(s); saw ${requestCount ?? 0}`,
  );
}

export async function waitForTurnCancelled(threadStore: JsonThreadStore, threadId: string) {
  return waitForTestState(
    () => threadStore.listEvents(threadId, 0),
    (events) => events.some((event) => event.type === 'turn.cancelled'),
    (events) => `Timed out waiting for turn cancellation; event types=${JSON.stringify((events ?? []).map((event) => event.type))}`,
  );
}

export async function waitForTurnCompleted(threadStore: ThreadStore, threadId: string, turnId: string) {
  return waitForTestState(
    () => threadStore.listEvents(threadId, 0),
    (events) => events.some((event) => event.type === 'turn.completed' && event.turnId === turnId),
    (events) => `Timed out waiting for turn completion ${turnId}; event types=${JSON.stringify((events ?? []).map((event) => event.type))}`,
  );
}

export function testRuntimeEnvironment(id: string, workspaceRoot: string): RuntimeEnvironment {
  return {
    id,
    cwd: workspaceRoot,
    workspaceRoot,
    workspaceRoots: [workspaceRoot],
  };
}

export function stepSnapshotSkillRegistry(): SkillRegistry {
  return {
    selectedSkillInjections: async (skillIds?: string[]) => (skillIds?.includes('skill_step')
      ? [{ id: 'skill_step', name: 'Step Skill', content: 'Use the step snapshot fixture.' }]
      : []),
  } as SkillRegistry;
}
