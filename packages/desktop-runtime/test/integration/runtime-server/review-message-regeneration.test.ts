import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { createOpenAiCaptureServer, withTimeout } from '../../support/runtime-server/shared.js';

it('edits a persisted review in place, preserving review policy/model and validating before rewriting history', async () => {
  const harness = await createRuntimeServerTestHarness();
  const providers = await Promise.all(['conversation', 'original_review', 'edited_review'].map(async (id) => ({
    id, ...await createOpenAiCaptureServer(`Response from ${id}.`),
  })));
  const settingsPath = '/v1/features/desktop-review/settings';
  try {
    await harness.runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: 'conversation',
        desktopSettings: { interfaceLanguage: 'en-US' },
        providers: providers.map(({ id, baseUrl }) => ({
          id, name: id, provider: 'openai-compatible', baseUrl, apiKey: `sk-${id}`, enabled: true,
          models: [{
            id: `${id}_model`, name: id, code: `${id}_model`, enabled: true,
            maxOutputTokens: 1_000, thinkingEnabled: false, thinkingEfforts: [], supportsImages: id === 'conversation',
          }],
        })),
      }),
    });
    const settings = await harness.runtimeFetch(settingsPath);
    const originalSettings = await harness.runtimeFetch(settingsPath, {
      method: 'PATCH', body: JSON.stringify({
        expectedRevision: settings.revision,
        selection: { providerId: 'original_review', modelId: 'original_review_model' },
      }),
    });
    const thread: RuntimeThread = await harness.runtimeFetch('/v1/threads', {
      method: 'POST', body: JSON.stringify({ title: 'Editable review' }),
    });
    const started = await harness.runtimeFetch(`/v1/features/desktop-review/threads/${thread.id}/reviews`, {
      method: 'POST', body: JSON.stringify({ language: 'en-US', target: { type: 'uncommittedChanges' } }),
    });
    const reviewed = await harness.waitForCompletedTurn(thread.id, started.turnId);
    const original = reviewed.messages.find((message) => message.inputKind === 'review')!;
    const following = await harness.runtimeFetch(`/v1/threads/${thread.id}/turns`, {
      method: 'POST', body: JSON.stringify({ input: 'A later message that will be truncated.' }),
    });
    await harness.waitForCompletedTurn(thread.id, following.turnId);
    await harness.runtimeFetch(settingsPath, {
      method: 'PATCH', body: JSON.stringify({
        expectedRevision: originalSettings.revision,
        selection: { providerId: 'edited_review', modelId: 'edited_review_model' },
      }),
    });

    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const before: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${thread.id}`);
    const regenerationPath = `/v1/threads/${thread.id}/messages/${original.id}/regenerate`;
    // The conversation model accepts images; the dedicated review model does not.
    await expect(harness.runtimeFetch(regenerationPath, {
      method: 'POST', body: JSON.stringify({
        content: 'Rejected edit',
        attachments: [{ id: 'remote', name: 'diagram.png', type: 'image/png', size: 4, url: 'https://example.test/diagram.png' }],
      }),
    })).rejects.toThrow('当前模型未启用图片输入');
    const afterFailure: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${thread.id}`);
    expect(afterFailure.messages).toEqual(before.messages);
    expect(afterFailure.lastSeq).toBe(before.lastSeq);

    const content = 'Review only the queue concurrency changes.';
    const regenerated = await harness.runtimeFetch(regenerationPath, {
      method: 'POST', body: JSON.stringify({ content, attachments: [], skillIds: [], skillReferences: [] }),
    });
    const request = await withTimeout(providers[2]!.nextBody, harness.providerCaptureTimeoutMs, 'Waiting for regenerated review request');
    const completed = await harness.waitForCompletedTurn(thread.id, regenerated.turnId);
    expect(request).toMatchObject({ model: 'edited_review_model' });
    const messages = request.messages as Array<{ role: string; content: string }>;
    expect(messages.filter((message) => message.role === 'user' && JSON.stringify(message.content).includes(content))).toHaveLength(1);
    expect(JSON.stringify(messages)).toContain('Inspect the relevant diff and return the review findings.');
    expect(JSON.stringify(messages)).toContain('User steering does not lift this read-only restriction.');
    expect(JSON.stringify(messages)).not.toContain('Response from original_review.');
    expect(JSON.stringify(messages)).not.toContain('A later message that will be truncated.');
    const toolNames = (request.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
    expect(toolNames).toEqual(expect.arrayContaining(['exec_command', 'read_file']));
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('apply_patch');
    expect(completed.messages.filter((message) => message.role === 'user')).toEqual([
      expect.objectContaining({ id: original.id, inputKind: 'review', content }),
    ]);
    expect(completed.messages.some((message) => message.turnId === following.turnId)).toBe(false);
    expect(completed.messages.filter((message) => message.reviewMode).map((message) => message.reviewMode?.kind)).toEqual(['entered', 'exited']);
    expect(completed.turns).toContainEqual(expect.objectContaining({ id: regenerated.turnId, taskKind: 'review', status: 'completed' }));
    expect(completed.modelBinding).toEqual(before.modelBinding);
    expect(completed.messages).toContainEqual(expect.objectContaining({ role: 'assistant', content: 'Response from edited_review.' }));
  } finally {
    await harness.close();
    await Promise.all(providers.map((provider) => provider.close()));
  }
});
