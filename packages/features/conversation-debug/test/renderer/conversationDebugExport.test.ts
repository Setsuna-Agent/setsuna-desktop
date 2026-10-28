import { expect, it } from 'vitest';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { createConversationDebugExport, debugExportFilename } from '../../src/renderer/conversationDebugExport.js';
import type { ConversationDebugGraph } from '../../src/renderer/conversationDebugGraph.js';
it('exports phase durations without conversation text, tool arguments or credentials', () => {
  const graph = { turns: [{ id: 'turn', status: 'success', inputPreview: 'private prompt' }], nodes: [{
    id: 'phase', turnId: 'turn', kind: 'model-request', lane: 'provider', status: 'success',
    startedAt: '2026-10-28T00:00:00.000Z', completedAt: '2026-10-28T00:00:01.250Z',
    summary: 'private summary', events: [{ apiKey: 'sk-secret' }], traces: [{ input: 'private input' }],
  }] } as unknown as ConversationDebugGraph;
  const exported = createConversationDebugExport({ id: 'thread' } as RuntimeThread, graph);
  expect(exported.phases[0].durationMs).toBe(1250);
  expect(JSON.stringify(exported)).not.toMatch(/private|sk-secret|apiKey/);
  expect(debugExportFilename('../project', 'thread:a', new Date('2026-10-28T00:00:00Z'))).not.toMatch(/[<>:"/\\|?*]/);
});
