import type {
  WorkspaceEntrySearchItem,
  WorkspaceEntrySearchResponse,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Translate } from '../../../../../src/shared/i18n/I18nProvider.js';
import {
  startProjectEntrySearch,
  type ProjectEntrySearchState,
} from '../../../../../src/features/chat/composer/chatProjectEntrySearch.js';

const t = ((key: string) => key) as Translate;

describe('project entry command search', () => {
  it('ignores a superseded request that resolves after the latest query', async () => {
    const first = deferredSearch();
    const second = deferredSearch();
    const states: ProjectEntrySearchState[] = [];
    const cancelFirst = startProjectEntrySearch({
      onStateChange: (state) => states.push(state),
      query: 'src',
      search: first.search,
      t,
    });
    cancelFirst();
    startProjectEntrySearch({
      onStateChange: (state) => states.push(state),
      query: 'docs',
      search: second.search,
      t,
    });

    second.resolve(response([
      { kind: 'directory', name: 'docs', parent: '', path: 'docs' },
    ]));
    await vi.waitFor(() => expect(states.at(-1)?.entries[0]?.path).toBe('docs'));
    first.resolve(response([
      { kind: 'directory', name: 'src', parent: '', path: 'src' },
    ]));
    await Promise.resolve();
    await Promise.resolve();

    expect(states.at(-1)?.entries[0]?.path).toBe('docs');
    expect(states.some((state) => state.entries[0]?.path === 'src')).toBe(false);
  });

  it('settles truncated results and rejected searches into explicit menu states', async () => {
    const truncatedStates: ProjectEntrySearchState[] = [];
    startProjectEntrySearch({
      onStateChange: (state) => truncatedStates.push(state),
      query: '',
      search: async () => response([], true),
      t,
    });
    await vi.waitFor(() => expect(truncatedStates.at(-1)?.loading).toBe(false));
    expect(truncatedStates.at(-1)?.loadError).toBe('chat.composer.searchTruncated');

    const failedStates: ProjectEntrySearchState[] = [];
    startProjectEntrySearch({
      onStateChange: (state) => failedStates.push(state),
      query: '',
      search: async () => {
        throw new Error('workspace unavailable');
      },
      t,
    });
    await vi.waitFor(() => expect(failedStates.at(-1)?.loading).toBe(false));
    expect(failedStates.at(-1)).toEqual({
      entries: [],
      loadError: 'workspace unavailable',
      loading: false,
    });
  });
});

function deferredSearch() {
  let resolve!: (value: WorkspaceEntrySearchResponse) => void;
  const promise = new Promise<WorkspaceEntrySearchResponse>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    resolve,
    search: () => promise,
  };
}

function response(
  entries: WorkspaceEntrySearchItem[],
  truncated = false,
): WorkspaceEntrySearchResponse {
  return {
    entries,
    query: '',
    scanned: entries.length,
    truncated,
    workspaceRoot: '/workspace',
  };
}
