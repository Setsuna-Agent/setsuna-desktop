import type { RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

let harness: RuntimeServerTestHarness;
beforeEach(async () => { harness = await createRuntimeServerTestHarness(); });
afterEach(async () => { await harness.close(); });

it('persists replacement/removed attachments through edit and regeneration, preserving omitted attachments across restart', async () => {
  const oldAttachment = await upload('original.txt');
  const replacement = await upload('replacement.txt');
  const { threadId, messageId } = await sentMessage(oldAttachment);
  const messagePath = `/v1/threads/${threadId}/messages/${messageId}`;
  const regenerate = async (input: object) => {
    const started = await harness.runtimeFetch(`${messagePath}/regenerate`, { method: 'POST', body: JSON.stringify(input) });
    return harness.waitForCompletedTurn(threadId, started.turnId);
  };
  const replaced = await regenerate({ content: '', attachments: [replacement] });
  expect(replaced.messages.filter((item) => item.role === 'user')).toEqual([
    expect.objectContaining({ id: messageId, content: '', attachments: [replacement] }),
  ]);
  await expect(harness.runtimeFetch(`/v1/attachments/${replacement.assetId}`, { method: 'DELETE' })).resolves.toEqual({ deleted: false });

  const preserved = await regenerate({ content: 'Keep the attachment.' });
  expect(preserved.messages.find((item) => item.id === messageId)?.attachments).toEqual([replacement]);
  await harness.server.close();
  await harness.startRuntimeServer(harness.runtimeDataDir);
  const restored = await harness.runtimeFetch(`/v1/threads/${threadId}`);
  expect(restored.messages.find((item: { id: string }) => item.id === messageId).attachments).toEqual([replacement]);

  const removed = await regenerate({ content: 'Text only.', attachments: [] });
  expect(removed.messages.find((item) => item.id === messageId)?.attachments).toEqual([]);
  const patched = await harness.runtimeFetch(messagePath, { method: 'PATCH', body: JSON.stringify({ content: '', attachments: [oldAttachment] }) });
  expect(patched.messages.find((item: { id: string }) => item.id === messageId)).toMatchObject({ content: '', attachments: [oldAttachment] });
  await expect(regenerate({ content: '', attachments: [] })).rejects.toThrow('Message content is required');
});

it('rejects foreign attachment ownership before changing the user message or truncating its replies', async () => {
  const ownAttachment = await upload('own.txt');
  const foreignAttachment = await upload('foreign.txt');
  const { threadId, messageId, thread } = await sentMessage(ownAttachment);
  await sentMessage(foreignAttachment);
  for (const method of ['PATCH', 'POST']) {
    const route = `/v1/threads/${threadId}/messages/${messageId}${method === 'POST' ? '/regenerate' : ''}`;
    await expect(harness.runtimeFetch(route, { method, body: JSON.stringify({ content: 'Rejected edit', attachments: [foreignAttachment] }) }))
      .rejects.toThrow('already owned by another thread');
    const after = await harness.runtimeFetch(`/v1/threads/${threadId}`);
    expect(after.messages).toEqual(thread.messages);
    expect(after.lastSeq).toBe(thread.lastSeq);
  }
});

async function upload(name: string): Promise<RuntimeStoredMessageAttachment> {
  const response = await fetch(`${harness.baseUrl}/v1/attachments?${new URLSearchParams({ name, type: 'text/plain' })}`, {
    method: 'POST', headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(name),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<RuntimeStoredMessageAttachment>;
}

async function sentMessage(attachment: RuntimeStoredMessageAttachment) {
  // Keep unrelated title/memory jobs out of the ledger whose sequence is asserted below.
  const created = await harness.runtimeFetch('/v1/threads', {
    method: 'POST', body: JSON.stringify({ title: 'Attachment fixture', memoryMode: 'disabled' }),
  });
  const started = await harness.runtimeFetch(`/v1/threads/${created.id}/turns`, {
    method: 'POST', body: JSON.stringify({ input: 'Original prompt', attachments: [attachment] }),
  });
  const thread = await harness.waitForCompletedTurn(created.id, started.turnId);
  const user = thread.messages.find((item) => item.role === 'user')!;
  return { threadId: thread.id, messageId: user.id, thread };
}
