import type { RuntimeConfigState, RuntimeMessage } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import type { ConfigStore } from '../../../src/ports/config-store.js';
import { RuntimeBackgroundCompaction } from '../../../src/loop/context/runtime-background-compaction.js';
import type { PreparedContextCompaction, RuntimeContextCompactionInput } from '../../../src/loop/context/runtime-context-compactor.js';

const services: RuntimeBackgroundCompaction[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.shutdown(50))); });

describe('background compaction lifecycle', () => {
  it('does not delay a soft-limit request, waits at the hard limit and installs the same candidate with the appended suffix', async () => {
    const { service, compactor, input, release, started } = fixture();
    service.start(input);
    await started;
    await expect(service.beforeRequest(input)).resolves.toEqual(input.messages);
    expect(compactor.install).not.toHaveBeenCalled();
    const appended = { ...input, messages: [...input.messages, message('correction', 'Preserve this new correction. '.repeat(500))] };
    let finished = false;
    const resumed = service.beforeRequest(appended).then((value) => { finished = true; return value; });
    await Promise.resolve();
    expect(finished).toBe(false);
    service.start(appended);
    release();
    expect((await resumed).at(-1)?.id).toBe('correction');
    expect(compactor.prepare).toHaveBeenCalledTimes(1);
    expect(compactor.install).toHaveBeenCalledTimes(1);
    expect(compactor.compactMessagesBeforeModelRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['edit', 'model', 'instructions', 'credentials', 'unreadable-config'] as const)('discards a ready candidate after changing %s', async (change) => {
    const { service, compactor, input, release, started, config } = fixture();
    service.start(input);
    await started;
    release();
    await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
    const next = { ...input, messages: [...input.messages] };
    if (change === 'edit') next.messages[0] = { ...next.messages[0]!, content: 'Edited constraint' };
    if (change === 'model') next.conversationModel = { ...input.conversationModel!, model: 'replacement' };
    if (change === 'instructions') next.requestContextKey = 'new-instructions';
    // The public preview is intentionally identical; the full private credential must invalidate reuse.
    if (change === 'credentials') config.key = 'new-key-with-same-public-preview';
    if (change === 'unreadable-config') config.unreadable = true;
    await service.beforeRequest(next);
    expect(compactor.install).not.toHaveBeenCalled();
    expect(compactor.compactMessagesBeforeModelRequest).toHaveBeenCalledTimes(1);
  });

  it('isolates a failed generation and suppresses retries for the same unchanged window', async () => {
    const { service, compactor, input, release, started } = fixture(true);
    service.start(input);
    await started;
    release();
    await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
    service.start(input);
    await expect(service.beforeRequest(input)).resolves.toEqual(input.messages);
    expect(compactor.prepare).toHaveBeenCalledTimes(1);
    expect(compactor.install).not.toHaveBeenCalled();
  });

  it('aborts on configuration notifications and does not overlap a provider that has not yet stopped', async () => {
    const { service, compactor, input, release, started, config } = fixture();
    service.start(input);
    await started;
    config.changed();
    service.start(input);
    expect(compactor.prepare).toHaveBeenCalledTimes(1);
    expect(compactor.prepare.mock.calls[0]![0].signal.aborted).toBe(true);
    release();
    await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
    await service.beforeRequest(input);
    expect(compactor.install).not.toHaveBeenCalled();
  });

  it('bounds shutdown, discards late completion and cannot restart after closure', async () => {
    const { service, compactor, input, release, started } = fixture();
    service.start(input);
    await started;
    await expect(service.shutdown(10)).resolves.toBe(false);
    release();
    await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
    service.start(input);
    await service.beforeRequest(input);
    expect(compactor.prepare).toHaveBeenCalledTimes(1);
    expect(compactor.install).not.toHaveBeenCalled();
  });

  it('releases a hard-limit waiter when configuration changes even if the old provider has not stopped', async () => {
    const { service, compactor, input, release, started, config } = fixture();
    service.start(input);
    await started;
    const next = { ...input, messages: [...input.messages, message('more', 'z'.repeat(20_000))] };
    const waiting = service.beforeRequest(next);
    config.changed();
    await expect(waiting).resolves.toEqual(next.messages);
    expect(compactor.install).not.toHaveBeenCalled();
    expect(service.pendingCount()).toBe(1);
    release();
  });

  it('keeps an aborted hard-limit waiter responsive while retaining a single in-flight task', async () => {
    const { service, compactor, input, release, started } = fixture();
    service.start(input);
    await started;
    const controller = new AbortController();
    const waiting = service.beforeRequest({ ...input, signal: controller.signal, messages: [...input.messages, message('more', 'z'.repeat(20_000))] });
    controller.abort(new Error('User cancelled'));
    await expect(waiting).rejects.toThrow('User cancelled');
    expect(compactor.install).not.toHaveBeenCalled();
    expect(service.pendingCount()).toBe(1);
    release();
  });
});

function fixture(fail = false) {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const config = { key: 'private-key', unreadable: false, changed: () => undefined as void };
  const runtimeConfig = { features: { backgroundContextCompaction: true }, providers: [], activeProviderId: 'provider' } as unknown as RuntimeConfigState;
  const configStore = {
    getConfig: async () => { if (config.unreadable) throw new Error('Config read failed'); return runtimeConfig; },
    getProviderConfig: async () => ({ id: 'provider', apiKey: config.key }),
    subscribe: (listener: () => void) => { config.changed = listener; return () => { config.changed = () => undefined; }; },
  } as unknown as ConfigStore;
  const input = {
    messages: [message('old', 'x'.repeat(32_500)), message('last', 'Continue')],
    contextBudget: { maxContextTokens: 12_000, autoCompactTokenLimit: 10_000 },
    threadId: 'thread', turnId: 'turn', thread: {}, force: false, runtimeConfig,
    conversationModel: { providerId: 'provider', model: 'model' }, requestContextKey: 'instructions',
    signal: new AbortController().signal,
  } as RuntimeContextCompactionInput;
  const compactor = {
    prepare: vi.fn(async (snapshot: RuntimeContextCompactionInput) => {
      markStarted();
      await gate;
      if (fail) throw new Error('Provider failed');
      return { input: snapshot } as PreparedContextCompaction;
    }),
    install: vi.fn(async (_prepared: PreparedContextCompaction, current: RuntimeContextCompactionInput) => current.messages),
    compactMessagesBeforeModelRequest: vi.fn(async (current: RuntimeContextCompactionInput) => current.messages),
  };
  const service = new RuntimeBackgroundCompaction({ compactor, configStore, eventBus: new InMemoryEventBus() });
  services.push(service);
  return { service, compactor, input, release, started, config };
}

function message(id: string, content: string): RuntimeMessage {
  return { id, content, role: 'user', status: 'complete', createdAt: '2026-10-30T00:00:00Z' };
}
