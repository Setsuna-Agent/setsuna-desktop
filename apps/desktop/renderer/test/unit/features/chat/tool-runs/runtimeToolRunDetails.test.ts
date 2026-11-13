import { describe, expect, it } from 'vitest';
import { translate, type Translate } from '../../../../../src/shared/i18n/I18nProvider.js';
import { genericToolRunDetailRuns } from '../../../../../src/features/chat/tool-runs/runtimeToolRunDetails.js';
import { groupToolRuns, toolRunGroupRuns } from '../../../../../src/features/chat/tool-runs/RuntimeToolRunPresentation.js';
import { toolRun } from './RuntimeToolRuns.support.js';

const t: Translate = (key, params) => translate('zh-CN', key, params);

describe('repeated tool activity', () => {
  it('omits empty repetition from details without losing targets, pending decisions or diagnostics', () => {
    const runs = [
      toolRun('search_first', 'search_tools', { query: 'agent' }),
      toolRun('search_next', 'search_tools', { query: 'subagent' }, 'running'),
      toolRun('web', 'mcp Demo fetchWebContent', { url: 'https://example.com/guide' }),
      { ...toolRun('pending', 'search_tools', { query: 'agent' }, 'pending_approval'), approvalId: 'approval_search' },
      { ...toolRun('rejected', 'search_tools', {}, 'rejected'), resultPreview: 'Network access is disabled by workspace policy.' },
    ];

    expect(genericToolRunDetailRuns(runs, t)).toEqual(runs.slice(2));
    expect(groupToolRuns(runs.slice(0, 2)).flatMap(toolRunGroupRuns)).toEqual(runs.slice(0, 2));
  });

  it('groups only consecutive calls from the same source without losing plugin calls', () => {
    const search = (id: string, pluginId: string) => ({
      ...toolRun(id, 'search_tools', { query: id }),
      plugin: { id: pluginId, name: pluginId },
    });
    const runs = [search('one', 'Alpha'), search('two', 'Alpha'), search('three', 'Beta'),
      toolRun('read', 'read_file', { file_path: 'README.md' }), search('four', 'Alpha')];
    const groups = groupToolRuns(runs);

    expect(groups.map((group) => toolRunGroupRuns(group).map((run) => run.id)))
      .toEqual([['one', 'two'], ['three'], ['read'], ['four']]);
    expect(groups.flatMap(toolRunGroupRuns)).toEqual(runs);
  });
});
