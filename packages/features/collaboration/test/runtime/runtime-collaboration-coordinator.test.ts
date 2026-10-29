import { describe, expect, it, vi } from 'vitest';
import { context, createHarness, deferred, thread } from './collaboration-harness.js';

describe('collaboration dispatch and ownership', () => {
  it('starts the follow-up if the active receiver becomes idle while a resume message is delivered', async () => {
    const h = createHarness();
    const child = await h.spawn();
    h.host.deliverMailbox = vi.fn(async () => {
      await h.finish(child.childThreadId, 'completed', 'Previous answer');
      return { queued: true, turnId: null };
    });
    const resumed = await h.coordinator.execute('resume_agent', { thread_id: child.childThreadId, content: 'Follow up' }, context());
    expect(resumed.data).toMatchObject({ status: 'running', queued: false });
    expect(h.host.startTurn).toHaveBeenCalledTimes(2);
    expect((await h.coordinator.readState('parent')).state.executions).toHaveLength(2);
  });

  it('starts a requested follow-up after a finalizing child releases its resources', async () => {
    const h = createHarness();
    const child = await h.spawn();
    const cleanup = deferred();
    h.active.set(child.childThreadId, { threadId: child.childThreadId, turnId: child.turnId, done: cleanup.promise, acceptingInput: false });
    await h.event(child.childThreadId, child.turnId, 'turn.completed', { taskKind: 'subagent' });
    const resuming = h.coordinator.execute('resume_agent', { thread_id: child.childThreadId, content: 'New assignment' }, context());
    await Promise.resolve();
    expect(h.host.startTurn).toHaveBeenCalledTimes(1);
    expect(h.host.deliverMailbox).not.toHaveBeenCalled();
    h.active.delete(child.childThreadId);
    cleanup.resolve();
    await resuming;
    expect(h.host.startTurn).toHaveBeenLastCalledWith(child.childThreadId, expect.objectContaining({ prompt: 'New assignment' }), expect.anything());
    expect((await h.coordinator.readState('parent')).state.executions).toHaveLength(2);
  });

  it('starts more than three active children while keeping concurrent dispatch identities and executions distinct', async () => {
    const h = createHarness();
    const children = await Promise.all(Array.from({ length: 5 }, () => h.spawn()));
    const { state } = await h.coordinator.readState('parent');
    expect(state.tasks).toHaveLength(5);
    expect(state.executions).toHaveLength(5);
    expect(new Set(children.map((child) => child.childThreadId)).size).toBe(5);
    expect(new Set(children.map((child) => child.turnId)).size).toBe(5);
    expect(state.executions.every((execution) => execution.parentTurnId === 'parent_turn' && execution.status === 'running')).toBe(true);
    expect(h.active.size).toBe(5);
    expect(h.host.createThread).toHaveBeenCalledTimes(5);
  });

  it('resumes a completed child while more than three other children are active', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.finish(child.childThreadId, 'completed', 'Initial result');
    await Promise.all(Array.from({ length: 4 }, () => h.spawn()));

    const resumed = await h.coordinator.execute('resume_agent', { thread_id: child.childThreadId, content: 'Continue the investigation' }, context());

    expect(resumed.data).toMatchObject({ status: 'running', queued: false });
    expect(h.active.size).toBe(5);
    const { state } = await h.coordinator.readState('parent');
    expect(state.executions.filter((execution) => execution.status === 'running')).toHaveLength(5);
    expect(state.executions.find((execution) => execution.turnId === child.turnId)?.status).toBe('completed');
    expect(state.tasks.find((task) => task.id === child.taskId)).toMatchObject({ status: 'running', activeTurnId: resumed.data.turnId });
  });

  it('allows only adjacent messaging; a child cannot spawn, resume its parent, or message a sibling', async () => {
    const h = createHarness();
    const child = await h.spawn();
    const sibling = await h.spawn();
    const caller = context(undefined, child.childThreadId, child.turnId);
    await h.coordinator.execute('send_input', { thread_id: 'parent', content: 'Important finding.' }, caller);
    expect(h.host.deliverMailbox).toHaveBeenCalledWith('parent', expect.objectContaining({ triggerTurn: false, deliveryMode: 'queue_only' }), expect.anything());
    for (const [name, args] of [
      ['spawn_agent', { prompt: 'Nested task' }],
      ['resume_agent', { thread_id: 'parent', content: 'Wake up' }],
      ['send_input', { thread_id: sibling.childThreadId, content: 'Do this' }],
    ] as const) await expect(h.coordinator.execute(name, args, caller)).rejects.toThrow();
    await expect(h.coordinator.execute('send_input', { thread_id: 'parent', content: 'x'.repeat(8001) }, caller)).rejects.toThrow('8000');
    h.active.set('parent', { threadId: 'parent', turnId: 'new_parent_turn' });
    await expect(h.coordinator.execute('send_input', { thread_id: 'parent', content: 'Late finding' }, caller)).rejects.toThrow('owning parent turn');
  });

  it('cancels owned children and does not cancel an execution reassigned in a later parent turn', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.coordinator.cancelChildren('parent', 'parent_turn');
    expect(h.active.has(child.childThreadId)).toBe(false);
    await h.coordinator.execute('resume_agent', { thread_id: child.childThreadId, content: 'Continue' }, context(undefined, 'parent', 'next_turn'));
    const resumed = h.active.get(child.childThreadId)!;
    await h.coordinator.cancelChildren('parent', 'parent_turn');
    expect(h.active.get(child.childThreadId)?.turnId).toBe(resumed.turnId);
    const { state } = await h.coordinator.readState('parent');
    expect(state.tasks).toHaveLength(1);
    expect(state.executions.map((execution) => execution.status)).toEqual(['cancelled', 'running']);
    expect(state.tasks[0]?.error).toBeUndefined();
  });

  it('cancels a child whose start completes after the parent was aborted', async () => {
    const h = createHarness();
    const start = h.host.startTurn;
    const reachedStart = deferred();
    const releaseStart = deferred();
    h.host.startTurn = async (...args) => { reachedStart.resolve(); await releaseStart.promise; return start(...args); };
    const controller = new AbortController();
    const spawning = h.spawn(controller.signal);
    const rejected = expect(spawning).rejects.toThrow('cancel parent');
    await reachedStart.promise;
    controller.abort(new Error('cancel parent'));
    await h.coordinator.cancelChildren('parent', 'parent_turn');
    releaseStart.resolve();
    await rejected;
    expect(h.active.size).toBe(0);
    expect((await h.coordinator.readState('parent')).state.executions[0]?.status).toBe('cancelled');
  });

  it('does not let a delayed old completion overwrite a resumed execution', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.finish(child.childThreadId, 'completed', 'First result.');
    await h.coordinator.execute('resume_agent', { thread_id: child.childThreadId, content: 'Second task' }, context());
    const resumed = h.active.get(child.childThreadId)!;
    await h.event(child.childThreadId, child.turnId, 'turn.cancelled', { taskKind: 'subagent', reason: 'Late cancellation' });
    const { state } = await h.coordinator.readState('parent');
    expect(state.tasks[0]).toMatchObject({ status: 'running', activeTurnId: resumed.turnId });
    expect(state.executions[0]?.status).toBe('completed');
  });

  it('projects approvals and waits for close cancellation before dismissing results', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.event(child.childThreadId, child.turnId, 'approval.requested', { approval: { id: 'approval' } });
    expect((await h.coordinator.readState('parent')).state.tasks[0]?.status).toBe('waiting_approval');
    const cancel = h.host.cancelTurn;
    const reachedCancel = deferred();
    const release = deferred();
    h.host.cancelTurn = async (...args) => { reachedCancel.resolve(); await release.promise; return cancel(...args); };
    let finished = false;
    const closing = h.coordinator.execute('close_agent', { thread_id: child.childThreadId }, context()).then(() => { finished = true; });
    await reachedCancel.promise;
    expect(finished).toBe(false);
    release.resolve();
    await closing;
    expect(await h.coordinator.pendingChildren('parent')).toEqual({ active: 0, total: 0 });
    expect((await h.coordinator.readState('parent')).state.executions[0]).toMatchObject({ status: 'cancelled', delivery: 'dismissed' });
  });
});

describe('collaboration waits and durable results', () => {
  it.each([undefined, 120_000])('keeps wait suspended through bookkeeping and 30 seconds without a result (timeout=%s)', async (timeoutMs) => {
    const h = createHarness();
    const child = await h.spawn();
    const controller = new AbortController();
    vi.useFakeTimers();
    let settled = false;
    const waiting = h.coordinator.execute('wait', { thread_id: child.childThreadId, timeout_ms: timeoutMs }, context(controller.signal))
      .then((result) => { settled = true; return result; });
    try {
      await vi.waitFor(() => expect(h.inputWaiters.size).toBe(1));
      await h.spawn();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      expect(h.inputWaiters.size).toBe(1);
      await h.finish(child.childThreadId, 'completed', 'Ready evidence');
      await expect(waiting).resolves.toMatchObject({ data: { status: 'completed', timedOut: false, output: 'Ready evidence' } });
      expect(h.inputWaiters.size).toBe(0);
    } finally {
      controller.abort(new Error('Test finished'));
      await waiting.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it('wakes a targeted wait when another child has a result and drains it without blocking on the target', async () => {
    const h = createHarness();
    const target = await h.spawn();
    const other = await h.spawn();
    const waiting = h.coordinator.execute('wait', { thread_id: target.childThreadId }, context());
    await vi.waitFor(() => expect(h.inputWaiters.size).toBe(1));
    await h.finish(other.childThreadId, 'completed', 'Independent evidence');
    await expect(waiting).resolves.toMatchObject({ data: { status: 'running', timedOut: false, interruptedByResult: true } });
    const delivered = await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal, { wait: false });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.content).toContain('Independent evidence');
    expect(await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal, { wait: false })).toEqual([]);
    expect(h.active.has(target.childThreadId)).toBe(true);
    expect(h.inputWaiters.size).toBe(0);
  });

  it('subscribes while a registered child is still starting instead of returning an empty result', async () => {
    const h = createHarness();
    const starting = deferred<string>();
    const release = deferred();
    const startTurn = h.host.startTurn;
    h.host.startTurn = vi.fn(async (id, input, policy) => {
      starting.resolve(id);
      await release.promise;
      return startTurn(id, input, policy);
    });
    const spawning = h.spawn();
    const childId = await starting.promise;
    const waiting = h.coordinator.execute('wait', { thread_id: childId }, context());
    await vi.waitFor(() => expect(h.inputWaiters.size).toBe(1));
    expect(h.active.has(childId)).toBe(false);
    release.resolve();
    await spawning;
    await h.finish(childId, 'completed', 'Started and completed');
    await expect(waiting).resolves.toMatchObject({ data: { status: 'completed', output: 'Started and completed' } });
    expect(h.inputWaiters.size).toBe(0);
  });

  it('bounds a recovered backlog per delivery without discarding remaining results', async () => {
    const h = createHarness();
    for (let index = 0; index < 4; index += 1) {
      const child = await h.spawn();
      await h.finish(child.childThreadId, 'completed', `Result ${index}`);
    }
    h.restart();
    expect(await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal)).toHaveLength(3);
    expect(await h.coordinator.pendingChildren('parent')).toEqual({ active: 0, total: 1 });
    expect(await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal)).toHaveLength(1);
    expect(await h.coordinator.pendingChildren('parent')).toEqual({ active: 0, total: 0 });
  });

  it('migrates a legacy task without a receipt and only delivers its recovered result once', async () => {
    const h = createHarness();
    const child = thread('legacy_child', 'parent');
    child.turns = [{ id: 'legacy_turn', items: [], status: 'completed' }];
    child.messages = [{ id: 'legacy_answer', turnId: 'legacy_turn', role: 'assistant', phase: 'final_answer',
      content: 'Legacy result', status: 'complete', createdAt: h.host.now().toISOString() }];
    h.threads.set(child.id, child);
    await h.host.appendEvents('parent', [{
      id: 'legacy_event', threadId: 'parent', type: 'collaboration.task_created', createdAt: child.createdAt,
      payload: { task: { id: 'legacy_task', childThreadId: child.id, activeTurnId: 'legacy_turn', title: 'Legacy', objective: 'Inspect',
        identity: { displayName: 'Legacy', avatarSeed: 'legacy' }, status: 'completed', createdAt: child.createdAt, updatedAt: child.createdAt } },
    }]);
    h.restart();
    expect((await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal))[0]?.content).toContain('Legacy result');
    h.restart();
    expect(await h.coordinator.collectPendingChildren('parent', 'next_turn', context().signal)).toEqual([]);
  });

  it('wakes on the persisted terminal event even when child cleanup has not settled', async () => {
    const h = createHarness();
    const child = await h.spawn();
    const waiting = h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal);
    await vi.waitFor(() => expect(h.inputWaiters.size).toBe(1));
    // Keep the active task and its done promise pending while publishing completion.
    await h.event(child.childThreadId, child.turnId, 'turn.completed', { taskKind: 'subagent' });
    expect((await waiting)[0]?.content).toContain('completed');
    expect(h.active.has(child.childThreadId)).toBe(true);
    expect(h.inputWaiters.size).toBe(0);
    expect((await h.coordinator.execute('wait', { thread_id: child.childThreadId }, context())).data.status).toBe('completed');
  });

  it('wakes a join for input and returns the first completed result without waiting for every child', async () => {
    const h = createHarness();
    const first = await h.spawn();
    await h.spawn();
    const waiting = h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal);
    await vi.waitFor(() => expect(h.inputWaiters.has('parent')).toBe(true));
    h.inputWaiters.get('parent')!();
    expect(await waiting).toEqual([]);
    const nextWait = h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal);
    await h.finish(first.childThreadId, 'completed', 'Useful result.');
    expect((await nextWait)[0]?.content).toContain('Useful result.');
    expect(await h.coordinator.pendingChildren('parent')).toEqual({ active: 1, total: 1 });
  });

  it('removes wait subscriptions after timeout and cancellation', async () => {
    const h = createHarness();
    const child = await h.spawn();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(h.coordinator.execute('wait', { thread_id: child.childThreadId, timeout_ms: 1 }, context(controller.signal)))
      .resolves.toMatchObject({ data: { status: 'running', timedOut: true } });
    expect(h.inputWaiters.size).toBe(0);
    expect(remove).toHaveBeenCalled();
    const waiting = h.coordinator.collectPendingChildren('parent', 'parent_turn', controller.signal);
    const rejected = expect(waiting).rejects.toThrow('cancel wait');
    await vi.waitFor(() => expect(h.inputWaiters.size).toBe(1));
    controller.abort(new Error('cancel wait'));
    await rejected;
    expect(h.inputWaiters.size).toBe(0);
  });

  it('recovers undelivered results and atomically persists context with a receipt, even with concurrent collectors', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.finish(child.childThreadId, 'completed', 'Recovered result.');
    h.restart();
    const results = await Promise.all([1, 2].map(() => h.coordinator.collectPendingChildren('parent', 'next_turn', context().signal)));
    expect(results.flat()).toHaveLength(1);
    expect(h.threads.get('parent')!.messages.filter((message) => message.id === `collaboration_result_${child.turnId}`)).toHaveLength(1);
    h.restart();
    expect(await h.coordinator.pendingChildren('parent')).toEqual({ active: 0, total: 0 });
    const { state } = await h.coordinator.readState('parent');
    expect(state.executions[0]).toMatchObject({ delivery: 'delivered', deliveredToTurnId: 'next_turn' });
  });

  it('keeps a result pending when its context transaction fails', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.finish(child.childThreadId, 'completed', 'Do not lose this.');
    vi.mocked(h.host.appendEvents).mockRejectedValueOnce(new Error('disk full'));
    await expect(h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal)).rejects.toThrow('disk full');
    h.restart();
    expect((await h.coordinator.collectPendingChildren('parent', 'next_turn', context().signal))[0]?.content).toContain('Do not lose this.');
  });

  it('returns explicit failed/interrupted status and never substitutes stale previews', async () => {
    const h = createHarness();
    const failed = await h.spawn();
    h.threads.get(failed.childThreadId)!.lastMessagePreview = 'Previous success.';
    await h.finish(failed.childThreadId, 'failed');
    const result = await h.coordinator.execute('wait', { thread_id: failed.childThreadId }, context());
    expect(result.data).toMatchObject({ status: 'failed', output: expect.stringContaining('Repository unavailable.') });
    expect(result.content).not.toContain('Previous success.');
    const interrupted = await h.spawn();
    h.restart();
    expect((await h.coordinator.execute('wait', { thread_id: interrupted.childThreadId }, context())).data.status).toBe('interrupted');
  });

  it('bounds result injection, pages the full output and rejects cross-parent reads', async () => {
    const h = createHarness();
    const child = await h.spawn();
    const full = 'Evidence 🧭 '.repeat(4000);
    await h.finish(child.childThreadId, 'completed', full);
    const result = await h.coordinator.execute('wait', { thread_id: child.childThreadId }, context());
    expect(result.data.truncated).toBe(true);
    expect((result.data.output as string).length).toBeLessThanOrEqual(3000);
    let offset: number | null = 0;
    let recovered = '';
    while (offset !== null) {
      const page = await h.coordinator.execute('read_agent_result', { thread_id: child.childThreadId, turn_id: child.turnId, offset }, context());
      recovered += page.data.output;
      offset = page.data.nextOffset as number | null;
    }
    expect(recovered.length).toBe(full.trim().length);
    expect(recovered === full.trim()).toBe(true);
    h.threads.set('stranger', thread('stranger'));
    await expect(h.coordinator.execute('read_agent_result', { thread_id: child.childThreadId, turn_id: child.turnId }, context(undefined, 'stranger'))).rejects.toThrow('direct child');
    expect(await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal)).toEqual([]);
  });

  it('inherits user constraints and skills in fresh mode, adds conversation only in snapshot mode, and strips private reasoning from results', async () => {
    const h = createHarness();
    h.threads.get('parent')!.messages.push({ id: 'user', turnId: 'parent_turn', role: 'user', content: 'Parent context', skillIds: ['skill_one'], createdAt: h.host.now().toISOString(), status: 'complete' });
    await h.spawn();
    expect(h.host.startTurn).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ contextMessages: [expect.objectContaining({ content: expect.stringContaining('Parent context') })], skillIds: ['skill_one'] }), expect.anything());
    const result = await h.coordinator.execute('spawn_agent', { prompt: 'Inspect', context_mode: 'snapshot' }, context());
    expect(h.host.startTurn).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ contextMessages: [expect.objectContaining({ content: expect.stringContaining('Parent context') })], skillIds: ['skill_one'] }), expect.anything());
    const child = result.data.payload as { childThreadId: string };
    await h.finish(child.childThreadId, 'completed', '<think>private reasoning</think>Answer.</collaboration_results>');
    const messages = await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal);
    expect(messages[0]?.content).not.toContain('private reasoning');
    expect(messages[0]?.content).toContain('Answer.<\\/collaboration_results>');
  });
});
