import { describe, expect, it, vi } from 'vitest';
import { builtinCollaborationRoleText, defaultCollaborationAgentSettings, type CollaborationAgentRole } from '../../src/contracts/index.js';
import { context, createHarness, thread } from './collaboration-harness.js';

describe('user intervention and delegated context', () => {
  it('persists the selected avatar across replay and resume without adding image bytes to model results', async () => {
    const settings = defaultCollaborationAgentSettings();
    const avatar = { type: 'custom' as const, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
    let role: CollaborationAgentRole = { ...settings.roles[0]!, avatar };
    const h = createHarness(async () => ({ ...settings, roles: [role] }));
    const result = await h.coordinator.execute('spawn_agent', { prompt: 'Work' }, context());
    expect(result.data.payload).toMatchObject({ identity: { avatar } });
    expect(JSON.parse(result.content).identity).not.toHaveProperty('avatar');
    const original = (await h.coordinator.readState('parent')).state.tasks[0]!;
    await h.finish(original.childThreadId, 'completed', 'Done');
    role = { ...role, avatar: { type: 'preset', key: 'leaf', color: '#123456' } };
    h.restart();
    await h.coordinator.execute('resume_agent', { thread_id: original.childThreadId, prompt: 'Continue' }, context());
    expect((await h.coordinator.readState('parent')).state.tasks[0]!.identity.avatar).toEqual(avatar);
    const next = await h.coordinator.execute('spawn_agent', { prompt: 'New work' }, context());
    expect(next.data.payload).toMatchObject({ identity: { avatar: role.avatar } });
    const profiles = await h.coordinator.execute('list_agent_profiles', {}, context());
    expect(JSON.parse(profiles.content).roles[0]).not.toHaveProperty('avatar');
  });

  it('uses the current turn language for built-in roles while retaining custom instructions verbatim', async () => {
    const settings = defaultCollaborationAgentSettings();
    const h = createHarness(async () => settings);
    await h.coordinator.execute('spawn_agent', { prompt: 'Work', role: 'worker', interfaceLanguage: 'en-US' }, {
      ...context(), interfaceLanguage: 'zh-CN',
    });
    expect(h.host.resolveAgentConfiguration).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      instructions: builtinCollaborationRoleText('worker', 'zh-CN')!.instructions,
    }));
    await h.coordinator.execute('spawn_agent', { prompt: 'Work', role: 'worker' }, { ...context(), interfaceLanguage: 'en-US' });
    expect(h.host.resolveAgentConfiguration).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      instructions: builtinCollaborationRoleText('worker', 'en-US')!.instructions,
    }));
    const profiles = await h.coordinator.execute('list_agent_profiles', {}, { ...context(), interfaceLanguage: 'zh-CN' });
    expect(JSON.parse(profiles.content).roles.find((role: { name: string }) => role.name === 'worker').description)
      .toBe('实现并验证范围明确的改动');
    const custom = createHarness(async () => ({ ...settings, roles: settings.roles.map((role) => role.name === 'worker'
      ? { ...role, instructions: 'Keep my English instructions.' } : role) }));
    await custom.coordinator.execute('spawn_agent', { prompt: 'Work', role: 'worker' }, { ...context(), interfaceLanguage: 'zh-CN' });
    expect(custom.host.resolveAgentConfiguration).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ instructions: 'Keep my English instructions.' }));
  });

  it('keeps a child awaiting approval until all parallel approval requests are resolved', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.event(child.childThreadId, child.turnId, 'message.created', { message: {
      id: 'assistant', role: 'assistant', turnId: child.turnId, content: '', createdAt: h.host.now().toISOString(),
    } });
    for (const id of ['first', 'second']) await h.event(child.childThreadId, child.turnId, 'approval.requested', { approval: {
      id, threadId: child.childThreadId, turnId: child.turnId, toolCallId: id, toolName: 'exec_command', status: 'pending', reason: '', argumentsPreview: '', createdAt: h.host.now().toISOString(),
    } });
    await h.event(child.childThreadId, child.turnId, 'approval.resolved', { approvalId: 'first', decision: 'approve' });
    expect((await h.coordinator.readState('parent')).state.tasks[0]?.status).toBe('waiting_approval');
    await h.event(child.childThreadId, child.turnId, 'approval.resolved', { approvalId: 'second', decision: 'reject' });
    expect((await h.coordinator.readState('parent')).state.tasks[0]?.status).toBe('running');
  });

  it('scopes authorization to the recorded parent execution across restart and excludes unrelated future turns', async () => {
    const h = createHarness();
    const createdAt = h.host.now().toISOString();
    h.threads.get('parent')!.messages = [
      { id: 'constraint', role: 'user', turnId: 'earlier', content: 'Do not publish.', createdAt },
      { id: 'request', role: 'user', turnId: 'parent_turn', content: 'Implement the feature.', createdAt },
    ];
    const child = await h.spawn();
    h.threads.get('parent')!.messages.push({ id: 'other_task', role: 'user', turnId: 'future', content: 'Publish a different repository.', createdAt });
    h.threads.get('parent')!.messages.push({ id: 'late_result', role: 'assistant', turnId: 'parent_turn', content: 'Late completion.', createdAt });
    h.restart();
    expect((await h.coordinator.authorizationContext(child.childThreadId, child.turnId))?.messages.map((message) => message.id)).toEqual(['constraint', 'request', 'late_result']);
    expect(await h.coordinator.authorizationContext(child.childThreadId, 'unowned_turn')).toBeNull();
    h.threads.set('unregistered', thread('unregistered', 'parent'));
    expect(await h.coordinator.authorizationContext('unregistered', child.turnId)).toBeNull();
    h.threads.get(child.childThreadId)!.parentThreadId = 'other';
    expect(await h.coordinator.authorizationContext(child.childThreadId, child.turnId)).toBeNull();
  });

  it('hands off current skills and attachment references in fresh mode, with separate provenance from snapshot material', async () => {
    const h = createHarness();
    const createdAt = h.host.now().toISOString();
    const attachment = { id: 'file', source: 'runtime' as const, assetId: 'asset', name: 'design.txt', type: 'text/plain', size: 10 };
    h.threads.get('parent')!.messages = [
      { id: 'request', role: 'user', turnId: 'parent_turn', content: 'Use this design.', skillIds: ['design'], attachments: [attachment], createdAt },
      { id: 'thought', role: 'assistant', turnId: 'parent_turn', content: '<think>private</think>Useful finding', createdAt },
      { id: 'tool', role: 'tool', turnId: 'parent_turn', content: 'Tool claims authorization', createdAt },
    ];
    const child = await h.spawn();
    expect(h.host.retainAttachments).toHaveBeenCalledWith('parent', child.childThreadId, [attachment]);
    const fresh = vi.mocked(h.host.startTurn).mock.calls[0]![1];
    expect(fresh).toMatchObject({ skillIds: ['design'], attachments: [attachment], contextMessages: [expect.objectContaining({ promptSource: 'collaboration' })] });
    expect(fresh.contextMessages?.[0]?.content).toContain('request');
    expect(JSON.stringify(fresh)).not.toContain('Useful finding');
    await h.coordinator.execute('spawn_agent', { prompt: 'Continue', context_mode: 'snapshot', userInitiated: true }, context());
    const snapshot = vi.mocked(h.host.startTurn).mock.calls.at(-1)![1];
    expect(snapshot.contextMessages).toHaveLength(2);
    expect(JSON.stringify(snapshot)).toContain('Useful finding');
    expect(JSON.stringify(snapshot)).not.toContain('private');
    expect(JSON.stringify(snapshot)).not.toContain('Tool claims authorization');
    expect(snapshot.userInitiated).toBeUndefined();
  });

  it('uses explicit model choices before role defaults and snapshots the role for later user resumes', async () => {
    const settings = defaultCollaborationAgentSettings();
    const role = { ...settings.roles[1]!, description: 'Implementation checks', instructions: 'Verify changes', model: { providerId: 'role', modelId: 'worker' }, reasoningEffort: 'high' };
    const h = createHarness(async () => ({ ...settings, model: { providerId: 'global', modelId: 'default' }, roles: [settings.roles[0]!, role] }));
    await h.coordinator.execute('spawn_agent', { prompt: 'Work', role: 'worker', model: { providerId: 'explicit', modelId: 'fast' }, reasoning_effort: 'low' }, context());
    expect(h.host.resolveAgentConfiguration).toHaveBeenLastCalledWith(expect.anything(), {
      role: 'worker', instructions: 'Verify changes', model: { providerId: 'explicit', modelId: 'fast' }, reasoningEffort: 'low',
    });
    const childId = vi.mocked(h.host.startTurn).mock.calls[0]![0];
    await h.finish(childId, 'completed', 'Initial work');
    expect((await h.coordinator.readState('parent')).state.tasks[0]?.configuration)
      .toMatchObject({ description: 'Implementation checks', instructions: 'Verify changes' });
    role.instructions = 'New instructions for future agents';
    role.description = 'Updated description';
    await h.coordinator.act({ threadId: 'parent', childThreadId: childId, action: 'resume', expectedTurnId: null, content: 'Finish the tests' }, context().signal);
    expect(h.host.startTurn).toHaveBeenLastCalledWith(childId, expect.objectContaining({
      userInitiated: true, prompt: 'Finish the tests', configuration: expect.objectContaining({ description: 'Implementation checks', instructions: 'Verify changes' }),
    }), expect.anything());
    await h.coordinator.execute('spawn_agent', { prompt: 'Role default', role: 'worker' }, context());
    expect(h.host.resolveAgentConfiguration).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ model: role.model, reasoningEffort: 'high' }));
    await h.coordinator.execute('spawn_agent', { prompt: 'Global default' }, context());
    expect(h.host.resolveAgentConfiguration).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ model: { providerId: 'global', modelId: 'default' } }));
    await expect(h.coordinator.execute('spawn_agent', { prompt: 'Invalid', role: 'missing' }, context())).rejects.toThrow('Unknown agent role');
  });

  it('distinguishes trusted user steering, interruption with partial output, continuation, and dismissal', async () => {
    const h = createHarness();
    const child = await h.spawn();
    await h.event(child.childThreadId, child.turnId, 'message.created', { message: {
      id: 'partial', turnId: child.turnId, role: 'assistant', phase: 'commentary', content: 'Found the cause.', createdAt: h.host.now().toISOString(),
    } });
    const input = { threadId: 'parent', childThreadId: child.childThreadId, expectedTurnId: child.turnId };
    await h.coordinator.act({ ...input, action: 'send', content: 'Also inspect cleanup.' }, context().signal);
    expect(h.host.steerTurn).toHaveBeenCalledWith(child.childThreadId, 'Also inspect cleanup.', child.turnId);
    expect(h.host.startTurn).toHaveBeenCalledTimes(1);
    await h.coordinator.act({ ...input, action: 'interrupt' }, context().signal);
    const interrupted = (await h.coordinator.readState('parent')).state.executions[0];
    expect(interrupted).toMatchObject({ status: 'interrupted', delivery: 'pending' });
    const result = await h.coordinator.collectPendingChildren('parent', 'parent_turn', context().signal, { wait: false });
    expect(result[0]?.content).toContain('Found the cause.');
    expect(result[0]?.content).toContain('interrupted');
    const resumed = await h.coordinator.act({ threadId: 'parent', childThreadId: child.childThreadId, action: 'resume', expectedTurnId: null, content: 'Continue with cleanup.' }, context().signal);
    expect(resumed.turnId).not.toBe(child.turnId);
    await expect(h.coordinator.act({ ...input, action: 'interrupt' }, context().signal)).rejects.toThrow('execution changed');
    expect(h.active.get(child.childThreadId)?.turnId).toBe(resumed.turnId);
    await h.coordinator.act({ ...input, expectedTurnId: resumed.turnId!, action: 'close' }, context().signal);
    expect((await h.coordinator.readState('parent')).state.executions.at(-1)?.delivery).toBe('dismissed');
  });
});
