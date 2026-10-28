import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { ConversationDebugGraph } from './conversationDebugGraph.js';

/** Export a metadata allowlist; free-form prompts, tool arguments and provider payloads stay local. */
export function createConversationDebugExport(thread: RuntimeThread, graph: ConversationDebugGraph) {
  return {
    schemaVersion: 1,
    threadId: thread.id,
    projectId: thread.projectId,
    turns: graph.turns.map(({ id, status, seqStart, seqEnd }) => ({ id, status, seqStart, seqEnd })),
    phases: graph.nodes.map(({ id, turnId, kind, lane, status, startedAt, completedAt, seqStart, seqEnd }) => {
      const duration = completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : NaN;
      return { id, turnId, kind, lane, status, startedAt, completedAt, seqStart, seqEnd,
        ...(Number.isFinite(duration) && duration >= 0 ? { durationMs: duration } : {}),
      };
    }),
  };
}

export function debugExportFilename(project: string, thread: string, now = new Date()): string {
  const segment = (value: string) => value.normalize('NFKC').replace(/[<>:"/\\|?*]/gu, '-').replace(/\p{Cc}/gu, '-').replace(/[. ]+$/gu, '').slice(0, 64) || 'conversation';
  return `setsuna-${segment(project)}-${segment(thread)}-${now.toISOString().replaceAll(':', '-')}.json`;
}

export function downloadConversationDebugExport(thread: RuntimeThread, graph: ConversationDebugGraph): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(createConversationDebugExport(thread, graph), null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = debugExportFilename(thread.projectId ?? 'local', thread.id);
  anchor.click();
  // Let the browser consume the Blob before releasing its backing data.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
