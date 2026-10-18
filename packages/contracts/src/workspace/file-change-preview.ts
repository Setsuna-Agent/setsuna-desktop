import type { RuntimeMessage } from '../threads.js';
import type { RuntimeFileChangeOperation, RuntimeFileChangePreviewInput } from './file-change-group-types.js';
import { fileChangeMetadata, fileDiffRecordsFromRun } from './file-change-data.js';
import { isFileMutationToolName } from './file-change-groups.js';
import { projectFileDiff } from './file-diff-preview.js';

/** One budget covers all requested operations for the file, even a long sequence
 * of edits. No unrelated tool output, source file or lossless undo patch is copied. */
export function projectFileChangePreview(messages: RuntimeMessage[], input: RuntimeFileChangePreviewInput): RuntimeFileChangeOperation[] {
  const requested = new Set(input.toolCallIds);
  const operations: RuntimeFileChangeOperation[] = [];
  const diffs: unknown[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || message.visibility === 'model') continue;
    for (const run of message.toolRuns ?? []) {
      if (!requested.has(run.id) || run.status !== 'success' || !isFileMutationToolName(run.name)) continue;
      const files = fileDiffRecordsFromRun(run)
        .filter((file) => (file.absolutePath ?? file.path) === input.path)
        .map((file) => ({ ...fileChangeMetadata(file), lines: Array.isArray(file.lines) ? file.lines : [] }));
      if (!files.length) continue;
      requested.delete(run.id);
      operations.push({ messageId: message.id, run: { id: run.id, name: run.name, status: 'success' } });
      diffs.push({ type: 'patch_diff', diffs: files });
    }
    if (!requested.size) break;
  }
  const bounded = projectFileDiff({ type: 'patch_diff', diffs }) as { diffs: unknown[] };
  return operations.map((operation, index) => ({ ...operation, run: { ...operation.run, data: { diff: bounded.diffs[index] } } }));
}
