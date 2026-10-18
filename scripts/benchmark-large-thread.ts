import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { RuntimeSseParser } from '../apps/desktop/main/src/runtime/runtime-sse-parser.js';
import { projectFileChangePreview, projectMessagePageFileChanges, projectThreadFilePreviews, resolveMessageDeletionIds, type RuntimeMessage, type RuntimeMessagePage, type RuntimeThread, type RuntimeToolRun } from '@setsuna-desktop/contracts';

// Like the projection benchmark, resolve concrete runtime adapters at execution time so
// the diagnostic does not add runtime sources to the Electron TypeScript project.
const projectionsModule = '../packages/desktop-runtime/src/adapters/store/sqlite-thread-projections.js';
const diffModule = '../packages/desktop-runtime/src/adapters/tool/pc-local/pc-local-tool-diff.js';
const { threadTranscriptPage } = await import(projectionsModule) as {
  threadTranscriptPage(messages: RuntimeMessage[], query: { limit: number }): RuntimeMessagePage;
};
const { buildDeletedFileDiff } = await import(diffModule) as {
  buildDeletedFileDiff(input: { root: string; filePath: string; previousContent: Buffer; beforeMode: number }): unknown;
};

/** Synthetic legacy fixture only; no user data, UI, runtime processes or network access. */
const sizes = [2 * 1024 * 1024, 800 * 1024, 300 * 1024];
const bytes = sizes.map((size) => {
  const buffer = Buffer.allocUnsafe(size);
  let state = 0x12345678;
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    buffer[index] = state & 255;
  }
  buffer.write('MZ');
  return buffer;
});
const runs: RuntimeToolRun[] = bytes.map((buffer, index) => {
  const lines = buffer.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const diff = {
    type: 'file_diff', action: 'Deleted', path: `legacy-${index}.dll`, additions: 0, deletions: lines.length, truncated: false,
    lines: lines.map((content, position) => ({ type: 'del', lineNumber: position + 1, oldLine: position + 1, content })),
  };
  return { id: `call_${index}`, name: 'delete_file', status: 'success', data: { ok: true, diff }, resultPreview: JSON.stringify({ diff }) };
});
const legacy: RuntimeThread = {
  id: 'legacy', title: 'Synthetic oversized thread', archived: false, createdAt: '', updatedAt: '', lastSeq: 430,
  messageCount: 430, lastMessagePreview: '',
  messages: Array.from({ length: 430 }, (_, index) => ({
    id: `message_${index}`, turnId: 'long_turn', role: index === 0 ? 'user' : index % 2 ? 'assistant' : 'tool',
    content: `Progress ${index}`, createdAt: '', ...(index === 425 ? { toolRuns: runs } : {}),
  })),
};
const project = measured(() => projectThreadPage(legacy));
const withoutTurnIds = { ...legacy, messages: legacy.messages.map((message) => ({ ...message, turnId: undefined })) };
const legacyProject = measured(() => projectThreadPage(withoutTurnIds));
const deleteScope = measured(() => resolveMessageDeletionIds(withoutTurnIds.messages, {
  messageIds: withoutTurnIds.messages.slice(-160).map((message) => message.id), scope: 'turns',
}));
if (deleteScope.value.length !== 430) throw new Error('Deletion benchmark lost part of the turn');
const filePreview = measured(() => structuredClone(projectFileChangePreview(legacy.messages, {
  path: 'legacy-0.dll', toolCallIds: ['call_0'],
})));
const root = path.resolve('synthetic-workspace');
const generated = measured(() => bytes.map((previousContent, index) => buildDeletedFileDiff({
  root, filePath: path.join(root, `${index}.dll`), previousContent, beforeMode: 0o644,
})));
const data = JSON.stringify({ type: 'tool.completed', payload: runs[0] });
const frame = `event: runtime-event\ndata: ${data}\n\n`;
const streaming = [64 * 1024, 16 * 1024].map((chunkSize) => {
  const old = measured(() => {
    let pending = '';
    let frames = 0;
    for (let offset = 0; offset < frame.length; offset += chunkSize) {
      pending += frame.slice(offset, offset + chunkSize);
      pending = pending.replace(/\r\n/g, '\n');
      const chunks = pending.split('\n\n');
      pending = chunks.pop() ?? '';
      frames += chunks.length;
    }
    return frames;
  });
  const next = measured(() => {
    const parser = new RuntimeSseParser();
    let frames = 0;
    for (let offset = 0; offset < frame.length; offset += chunkSize) frames += parser.push(frame.slice(offset, offset + chunkSize)).length;
    return frames;
  });
  if (old.value !== 1 || next.value !== 1) throw new Error('SSE benchmark lost an event');
  return { chunkChars: chunkSize, previousMs: old.ms, incrementalMs: next.ms };
});
console.log(JSON.stringify({
  messages: { original: legacy.messages.length, page: project.value.messages.length, nextBefore: project.value.messagePage?.nextBefore },
  snapshotBytes: { original: Buffer.byteLength(JSON.stringify(legacy)), projected: Buffer.byteLength(JSON.stringify(project.value)) },
  displayProjectionMs: project.ms,
  fileOperationIndexBytes: Buffer.byteLength(JSON.stringify(project.value.fileChangeGroups)),
  deletionScope: { selectedMessages: 160, resolvedMessages: deleteScope.value.length, ms: deleteScope.ms },
  selectedFilePreview: { projectionAndCloneMs: filePreview.ms, bytes: Buffer.byteLength(JSON.stringify(filePreview.value)) },
  legacyWithoutTurnIds: {
    page: legacyProject.value.messages.length,
    projectionMs: legacyProject.ms,
    snapshotBytes: Buffer.byteLength(JSON.stringify(legacyProject.value)),
    fileOperationIndexBytes: Buffer.byteLength(JSON.stringify(legacyProject.value.fileChangeGroups)),
    operations: Object.values(legacyProject.value.fileChangeGroups ?? {}).flat().length,
  },
  binaryGeneration: { ms: generated.ms, totalJsonBytes: Buffer.byteLength(JSON.stringify(generated.value)) },
  streaming,
}, null, 2));

function projectThreadPage(thread: RuntimeThread): RuntimeThread {
  const page = projectMessagePageFileChanges(thread.messages, threadTranscriptPage(thread.messages, { limit: 160 }));
  return projectThreadFilePreviews({ ...thread, messages: page.messages, messagePage: { total: page.total, nextBefore: page.nextBefore },
    fileChangeGroups: page.fileChangeGroups,
  });
}

function measured<T>(operation: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = operation();
  return { value, ms: Math.round((performance.now() - start) * 100) / 100 };
}
