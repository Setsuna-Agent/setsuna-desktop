import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { groupToolRuns, toolRunDisplayStableKey } from '../../../../../src/features/chat/tool-runs/RuntimeToolRuns.js';
import { toolRun, fileRunWithDiff, groupLabel, renderedHtml } from './RuntimeToolRuns.support.js';

describe('RuntimeToolRuns disclosure behavior', () => {

  it('opens pending file diffs so changes can be reviewed before approval', () => {
    const pendingRun: RuntimeToolRun = {
      ...fileRunWithDiff('edit_pending', 'edit_file', 'src/pending.ts', 'pending_approval'),
      approvalId: 'approval_edit_pending',
    };
    const html = renderedHtml([pendingRun]);

    expect(html).toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
    expect(html).toContain('diff --git a/src/pending.ts b/src/pending.ts');
    expect(html).toContain('-return &#x27;before&#x27;;');
    expect(html).toContain('+return &#x27;after&#x27;;');
  });

  it('keeps the same disclosure identity when a streamed single run becomes a group', () => {
    const firstRun = toolRun('shell_1', 'run_shell_command', { command: 'pnpm typecheck' }, 'running');
    const single = groupToolRuns([firstRun])[0];
    const group = groupToolRuns([
      firstRun,
      toolRun('shell_2', 'run_shell_command', { command: 'pnpm lint' }, 'running'),
    ])[0];

    expect(single).toBeDefined();
    expect(group).toBeDefined();
    expect(toolRunDisplayStableKey(single!)).toBe('shell_1');
    expect(toolRunDisplayStableKey(group!)).toBe('shell_1');
  });

  it('keeps adjacent operation categories as separate display groups', () => {
    const groups = groupToolRuns([
      toolRun('read_1', 'workspace_read_file', { path: 'a.ts' }),
      toolRun('read_2', 'workspace_read_file', { path: 'b.ts' }),
      toolRun('search_1', 'workspace_search_text', { query: 'needle' }),
      toolRun('shell_1', 'run_shell_command', { command: 'pnpm lint' }),
      toolRun('shell_2', 'run_shell_command', { command: 'pnpm test' }),
    ]);

    expect(groups.map(groupLabel)).toEqual([
      'inspection:2',
      'single:workspace_search_text',
      'shell:2',
    ]);
  });

  it('keeps legacy Feature results independently addressable inside one tool batch', () => {
    const runs = [
      { ...toolRun('artifact_1', 'publish_artifact', {}), data: { artifact: { id: 'one' } } },
      { ...toolRun('artifact_2', 'publish_artifact', {}), data: { artifact: { id: 'two' } } },
    ];

    expect(groupToolRuns(runs, () => 'artifact.file')).toEqual([
      { type: 'single', run: runs[0] },
      { type: 'single', run: runs[1] },
    ]);
  });
});
