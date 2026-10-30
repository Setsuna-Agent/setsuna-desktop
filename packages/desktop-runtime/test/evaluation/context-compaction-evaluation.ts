import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProxyAgent } from 'undici';
import type { ModelRequest, RuntimeMessage, RuntimeConfigState, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeHost } from '@setsuna-desktop/feature-model-provider/contracts';
import { PiModelClient } from '../../../features/model-provider/src/runtime/pi-model-client.js';
import { FileConfigStore } from '../../src/adapters/store/file-config-store.js';
import { SqliteThreadStore } from '../../src/adapters/store/sqlite-thread-store.js';
import { InMemoryEventBus } from '../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../src/adapters/id/random-id-generator.js';
import { UsageTrackingModelClient } from '../../src/adapters/model/usage-tracking-model-client.js';
import { RuntimeContextCompactor, type RuntimeContextCompactionInput } from '../../src/loop/context/runtime-context-compactor.js';
import { RuntimeBackgroundCompaction } from '../../src/loop/context/runtime-background-compaction.js';
import { ContextCompactionCommitter } from '../../src/loop/context/context-compaction-commit.js';
import { RuntimeEventWriter } from '../../src/loop/lifecycle/runtime-event-writer.js';
import { estimateRuntimeMessageTokens } from '../../src/loop/context/context-compaction.js';
import { systemClock } from '../../src/ports/clock.js';
import { createModelStreamTextCollector } from '../../src/utils/model-stream-text-collector.js';
import type { ModelClient } from '../../src/ports/model-client.js';
import { evaluationInstructions, evaluationMessage, evaluationTools, evidence, expectedReport, checkReport, visualFixture } from './context-compaction-fixtures.js';

type CompactorConstructor = typeof RuntimeContextCompactor;
// Five independent files may be reread sequentially; leave room for the final response.
const MAX_CONTINUATION_REQUESTS = 8;
type CycleResult = {
  cycle: number; compactionMs: number; foregroundBlockedMs: number; checks: Record<string, boolean>;
  repeatedReads: number; response: string; incomingTokens: number; activeTokens: number;
  installedCompactions: number;
  estimatedHeadroomTokens: number;
  appendedMessagesSinceCompaction: number;
  handoff: string[];
};

/** Opt-in live-provider evaluation; credentials stay in memory and only synthetic evidence is sent. */
export async function runContextCompactionEvaluation(args: string[]): Promise<void> {
  const argument = (name: string, fallback?: string) => {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : fallback;
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const sourceStore = new FileConfigStore(argument('--data-dir'));
  const selected = await sourceStore.getProviderConfig(argument('--provider'));
  const code = argument('--model');
  const model = selected?.models.find((entry) => entry.code === code);
  if (!selected?.enabled || !model) throw new Error('Evaluation requires an existing configured provider and model.');
  const configured = { ...selected, activeModel: { ...model, thinkingEnabled: false, defaultThinkingEffort: undefined, maxOutputTokens: 8192 } };
  const switchProvider = args.includes('--switch-provider') ? await sourceStore.getProviderConfig(argument('--switch-provider')) : undefined;
  const switchModel = switchProvider?.models.find((entry) => entry.code === argument('--switch-model'));
  if (switchProvider && !switchModel) throw new Error('The switch model is not configured.');
  const alternative = switchProvider && switchModel ? { ...switchProvider,
    activeModel: { ...switchModel, thinkingEnabled: false, defaultThinkingEffort: undefined, maxOutputTokens: 8192 } } : undefined;
  const portable = args.includes('--portable');
  const proxyUrl = args.includes('--proxy') ? argument('--proxy') : undefined;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const proxyBypass = argument('--proxy-bypass', 'localhost,127.0.0.1').split(',');
  const config: RuntimeConfigState = {
    ...(await sourceStore.getConfig()), activeProviderId: selected.id,
    providers: [configured, ...(alternative ? [alternative] : [])].map(({ apiKey, ...provider }) => ({
      ...provider, apiKeySet: Boolean(apiKey), apiKeyPreview: '', models: [provider.activeModel],
    })),
    taskModels: portable ? { contextCompaction: { providerId: selected.id, modelId: model.id } } : {},
    features: { backgroundContextCompaction: true },
  };
  const records: RuntimeUsageRecord[] = [];
  const protocols: string[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  const host: ModelProviderRuntimeHost = {
    appVersion: 'compaction-evaluation', dataDir: '', writeClipboardText: async () => undefined,
    resolveProvider: async (id) => alternative && alternative.id === id ? alternative : configured,
    readProviderState: async () => ({ activeProviderId: selected.id, providers: config.providers }),
    saveProviderState: async () => { throw new Error('Live evaluation never changes provider settings.'); },
    reportModelDiagnostic: ({ phase, elapsedMs, status, responseBytes, inputTokens, outputTokens }) => {
      if (['http.headers', 'http.completed', 'http.stream_failed', 'model.failed', 'model.usage'].includes(phase))
        diagnostics.push({ phase, elapsedMs, status, responseBytes, inputTokens, outputTokens });
    },
    fetchForRoute: () => (async (input, init) => globalThis.fetch(input,
      { ...init, ...(dispatcher && !proxyBypass.includes(new URL(input instanceof Request ? input.url : String(input)).hostname) ? { dispatcher } : {}) } as RequestInit)),
  };
  const inner = new PiModelClient(host);
  const client: ModelClient = new UsageTrackingModelClient({
    stream: (request) => inner.stream(request),
    compactConversation: async (request) => {
      const result = await inner.compactConversation(request);
      protocols.push(result.kind === 'native' ? result.mode ?? 'responses-compact' : result.kind);
      return result;
    },
  }, { clock: systemClock, recorder: { recordUsage: async (input) => {
    const record = { ...input, id: `usage-${records.length + 1}` };
    records.push(record);
    return record;
  } } });
  const baselineRoot = args.includes('--baseline-root') ? argument('--baseline-root') : undefined;
  const baseline: CompactorConstructor | undefined = baselineRoot
    ? (await import(pathToFileURL(path.join(baselineRoot, 'packages/desktop-runtime/src/loop/context/runtime-context-compactor.ts')).href)).RuntimeContextCompactor
    : undefined;
  const strategies = argument('--strategies', baseline ? 'baseline,foreground,background' : 'foreground,background').split(',');
  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(), model: code, providerKind: selected.provider,
    switchModel: alternative?.activeModel.code,
    portable, transport: proxyUrl ? 'explicit-proxy' : 'direct', cyclesPerStrategy: 5,
    maxContinuationRequests: MAX_CONTINUATION_REQUESTS,
    baselineRoot: baselineRoot ? path.basename(baselineRoot) : undefined, syntheticDataOnly: true, runs: [],
  };
  const output = path.resolve(argument('--output'));
  const persist = async () => { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
  try {
    for (const strategy of strategies) {
      if (strategy === 'baseline' && !baseline) throw new Error('Baseline strategy requires --baseline-root.');
      const fromRecord = records.length;
      const fromProtocol = protocols.length;
      const fromDiagnostic = diagnostics.length;
      try {
        const run = await evaluateStrategy(strategy, strategy === 'baseline' ? baseline! : RuntimeContextCompactor,
          client, config, { providerId: selected.id, model: code },
          alternative ? { providerId: alternative.id, model: alternative.activeModel.code } : undefined);
        (report.runs as unknown[]).push({ strategy, ...run, protocols: protocols.slice(fromProtocol), usage: usageTotals(records.slice(fromRecord)), diagnostics: diagnostics.slice(fromDiagnostic) });
      } catch (error) {
        (report.runs as unknown[]).push({ strategy, error: safeError(error), protocols: protocols.slice(fromProtocol), usage: usageTotals(records.slice(fromRecord)) });
      }
      await persist();
      process.stdout.write(JSON.stringify({ strategy, report: output, result: (report.runs as unknown[]).at(-1) }) + '\n');
    }
  } finally { await dispatcher?.close(); }
}

async function evaluateStrategy(strategy: string, Constructor: CompactorConstructor, client: ModelClient,
  config: RuntimeConfigState, model: Pick<ModelRequest, 'model' | 'providerId'>,
  alternative?: Pick<ModelRequest, 'model' | 'providerId'>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-compaction-evaluation-'));
  const ids = new RandomIdGenerator();
  let store = new SqliteThreadStore(directory, systemClock, ids);
  const thread = await store.createThread({ title: 'Synthetic compaction evaluation' });
  let writer = new RuntimeEventWriter(store, new InMemoryEventBus());
  let compactor = createCompactor();
  let background = new RuntimeBackgroundCompaction({ compactor });
  const cycles: CycleResult[] = [];
  const image = await visualFixture();
  let recoveryVerified = false;
  let cancellationVerified = false;
  let previousSourceMessageCount = 0;
  let lastInput: RuntimeContextCompactionInput | undefined;
  const append = async (message: RuntimeMessage) => writer.append(thread.id, {
    id: ids.id('event'), threadId: thread.id, createdAt: message.createdAt, type: 'message.created', payload: { message },
  });
  function createCompactor() {
    return new Constructor({ clock: systemClock, ids, modelClient: client,
      windows: new ContextCompactionCommitter(store, writer),
      appendEvent: (threadId, event) => writer.append(threadId, event), onCompacted: () => undefined,
      runCompactHooks: async () => ({}),
    });
  }
  try {
    await append(evaluationMessage('goal', 'user', '完成五批审计，持续保留已核实的代码及视觉卡片代码。负责人林甲，limit=128，平台必须依次为 macOS、Windows。用户后续修正优先。已验证的文件可以用 read_evidence 回查，但不要无故重复读取。'));
    for (let cycle = 1; cycle <= 5; cycle++) {
      if (cycle === 4 && alternative) model = alternative;
      const correction = cycle === 2 ? '更正：负责人改为林乙。' : cycle === 3 ? '更正：limit 改为 256，平台保持原样。' : cycle === 4 ? '最终更正：负责人改为林丙，其他约束不变。' : '继续保存已验证证据。';
      await append(evaluationMessage(`correction-${cycle}`, 'user', correction));
      const callId = `audit-${cycle}`;
      await append({ ...evaluationMessage(`call-${cycle}`, 'assistant', ''), toolCalls: [{ id: callId, name: 'read_evidence', arguments: JSON.stringify({ index: cycle }) }] });
      await append({ ...evaluationMessage(`evidence-${cycle}`, 'tool', evidence(cycle)), toolCallId: callId, toolName: 'read_evidence', ...(cycle === 1 ? { attachments: [image] } : {}) });
      await append(evaluationMessage(`observed-${cycle}`, 'assistant', `第 ${cycle} 批文件已核实。保持全部证据用于最终审计，不需要重复读取。`));
      await append(evaluationMessage(`next-${cycle}`, 'user', '继续任务，保留此前全部有效要求。'));
      const current = (await store.getThread(thread.id))!;
      const incomingTokens = estimateRuntimeMessageTokens(current.messages);
      // A tighter local window exercises the same provider under small-window admission pressure.
      const hardLimit = Math.max(4000, incomingTokens + 1000);
      const beforeEvents = await store.listEvents(thread.id);
      const sourceMessageCount = beforeEvents.filter((event) => event.type === 'message.created').length;
      const previousCompactions = beforeEvents.filter((event) => event.type === 'thread.context_compacted').length;
      const input: RuntimeContextCompactionInput = {
        messages: current.messages, transcriptMessages: current.messages, sourceSnapshot: { messages: current.messages, sourceMessageIds: current.messages.map((message) => message.id) },
        conversationModel: model, runtimeConfig: config, thread: current, threadId: thread.id, turnId: `evaluation-${cycle}`,
        contextBudget: { maxContextTokens: cycle >= 4 ? Math.max(24_000, hardLimit + 2000) : Math.max(48_000, hardLimit + 6000), autoCompactTokenLimit: hardLimit },
        reservedTokens: 1800, force: strategy !== 'background', signal: AbortSignal.timeout(180_000), requestContextKey: 'audit-policy-v1',
        prepareRequest: async (history) => ({ ...model, messages: [evaluationMessage('policy', 'system', evaluationInstructions), ...history], tools: evaluationTools, maxOutputTokens: 8192, thinking: false }),
      };
      lastInput = input;
      const started = performance.now();
      let boundary = started;
      if (strategy === 'background') {
        background.start(input);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        boundary = performance.now();
        await background.beforeRequest(input);
      } else await compactor.compactMessagesBeforeModelRequest(input);
      const compactionMs = performance.now() - started;
      const foregroundBlockedMs = performance.now() - boundary;
      const installed = (await store.getThread(thread.id))!;
      const installedCompactions = (await store.listEvents(thread.id)).filter((event) => event.type === 'thread.context_compacted').length - previousCompactions;
      if (installedCompactions !== 1) throw new Error(`Expected one installed checkpoint in cycle ${cycle}, received ${installedCompactions}.`);
      const response = await continueTask(client, model, installed.messages, cycle, thread.id, append);
      await append(evaluationMessage(`response-${cycle}`, 'assistant', response.text));
      cycles.push({ cycle, compactionMs: Math.round(compactionMs), foregroundBlockedMs: Math.round(foregroundBlockedMs),
        checks: checkReport(response.text, cycle), repeatedReads: response.repeatedReads, response: response.text,
        incomingTokens, activeTokens: estimateRuntimeMessageTokens(installed.messages), installedCompactions,
        estimatedHeadroomTokens: hardLimit - 1800 - estimateRuntimeMessageTokens(installed.messages),
        appendedMessagesSinceCompaction: sourceMessageCount - previousSourceMessageCount,
        handoff: installed.messages.filter((message) => message.contextCompaction && message.visibility !== 'transcript').map((message) => message.content) });
      previousSourceMessageCount = sourceMessageCount;
      process.stdout.write(JSON.stringify({ strategy, cycle, checks: cycles.at(-1)!.checks, compactionMs: Math.round(compactionMs), repeatedReads: response.repeatedReads }) + '\n');
      if (cycle === 3) {
        await background.shutdown(5000);
        const expected = (await store.getThread(thread.id))!.messages;
        await writer.flushAll();
        await store.close();
        store = new SqliteThreadStore(directory, systemClock, ids);
        await store.recover();
        recoveryVerified = JSON.stringify((await store.getThread(thread.id))!.messages) === JSON.stringify(expected);
        writer = new RuntimeEventWriter(store, new InMemoryEventBus());
        compactor = createCompactor();
        background = new RuntimeBackgroundCompaction({ compactor });
      }
    }
    if (strategy !== 'baseline') {
      const current = (await store.getThread(thread.id))!;
      const controller = new AbortController();
      const cancel = setTimeout(() => controller.abort(new Error('Evaluation cancellation')), 250);
      try {
        await compactor.compactMessagesBeforeModelRequest({ ...lastInput!, messages: current.messages, sourceSnapshot: undefined,
          force: true, runtimeConfig: config, conversationModel: model, thread: current, turnId: 'cancelled', signal: controller.signal });
      } catch { cancellationVerified = controller.signal.aborted && JSON.stringify((await store.getThread(thread.id))!.messages) === JSON.stringify(current.messages); }
      finally { clearTimeout(cancel); }
    }
    const waits = cycles.map((cycle) => cycle.foregroundBlockedMs).sort((a, b) => a - b);
    return { cycles, installedCheckpoints: cycles.length, executedCycles: cycles.length,
      passedCycles: cycles.filter((cycle) => Object.values(cycle.checks).every(Boolean)).length,
      expectedFinal: expectedReport(5), recoveryVerified, cancellationVerified,
      foregroundBlockedP50Ms: waits[Math.floor(waits.length / 2)], foregroundBlockedP95Ms: waits.at(-1),
      totalRepeatedReads: cycles.reduce((total, cycle) => total + cycle.repeatedReads, 0) };
  } catch (error) {
    const failedWindow = (await store.getThread(thread.id))?.messages ?? [];
    return { cycles, error: safeError(error), executedCycles: cycles.length,
      installedCheckpoints: (await store.listEvents(thread.id)).filter((event) => event.type === 'thread.context_compacted').length,
      passedCycles: cycles.filter((cycle) => Object.values(cycle.checks).every(Boolean)).length,
      recoveryVerified, cancellationVerified,
      failureHandoff: failedWindow.filter((message) => message.contextCompaction && message.visibility !== 'transcript').map((message) => message.content),
      lastToolCalls: failedWindow.filter((message) => message.toolCalls?.length).slice(-MAX_CONTINUATION_REQUESTS)
        .map((message) => ({ messageId: message.id, calls: message.toolCalls })),
    };
  } finally { await background.shutdown(5000); await store.close(); await rm(directory, { recursive: true, force: true }); }
}

async function continueTask(client: ModelClient, model: Pick<ModelRequest, 'model' | 'providerId'>,
  history: RuntimeMessage[], cycle: number, threadId: string,
  append: (message: RuntimeMessage) => Promise<unknown>): Promise<{ text: string; repeatedReads: number }> {
  const messages = [evaluationMessage('policy', 'system', evaluationInstructions), ...history,
    evaluationMessage(`audit-${cycle}`, 'user', `请交付截至第 ${cycle} 批的审计 JSON，包含全部已验证代码、当前负责人、limit、platforms 和 visualCode。`)];
  let repeatedReads = 0;
  for (let round = 0; round < MAX_CONTINUATION_REQUESTS; round++) {
    const output = createModelStreamTextCollector();
    let calls: NonNullable<RuntimeMessage['toolCalls']> = [];
    for await (const event of client.stream({ ...model, sessionId: threadId, messages, tools: evaluationTools, thinking: false, maxOutputTokens: 2048,
      signal: AbortSignal.timeout(120_000), usageContext: { threadId, turnId: `audit-${cycle}`, source: 'conversation' } })) {
      output.consume(event);
      if (event.type === 'tool_calls') calls = event.toolCalls;
    }
    const text = output.text();
    if (!calls.length) return { text, repeatedReads };
    const assistant = { ...evaluationMessage(`reread-${cycle}-${round}`, 'assistant', text), toolCalls: calls };
    await append(assistant);
    messages.push(assistant);
    for (const call of calls) {
      repeatedReads++;
      const index = Number((JSON.parse(call.arguments) as { index?: number }).index);
      const result = { ...evaluationMessage(`reread-result-${cycle}-${round}-${call.id}`, 'tool', index >= 1 && index <= cycle ? evidence(index) : 'No such inspected evidence.'),
        toolCallId: call.id, toolName: call.name, ...(index === 1 ? { attachments: [await visualFixture()] } : {}) };
      await append(result);
      messages.push(result);
    }
  }
  throw new Error('Continuation exceeded the bounded evidence reread loop.');
}

function usageTotals(records: RuntimeUsageRecord[]) {
  return records.reduce((total, record) => ({ calls: total.calls + 1, inputTokens: total.inputTokens + (record.inputTokens ?? 0),
    outputTokens: total.outputTokens + (record.outputTokens ?? 0), cachedInputTokens: total.cachedInputTokens + (record.cachedInputTokens ?? 0) }),
  { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000)
    .replace(/\bBearer\s+\S+|\bsk-[\w-]+/giu, '[redacted]');
}
