import type {
  WorkspaceEntrySearchItem,
  WorkspaceEntrySearchResponse,
} from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';

export type ProjectEntrySearchState = {
  entries: WorkspaceEntrySearchItem[];
  loadError: string;
  loading: boolean;
};

export const emptyProjectEntrySearchState: ProjectEntrySearchState = {
  entries: [],
  loadError: '',
  loading: false,
};

export function startProjectEntrySearch({
  onStateChange,
  query,
  search,
  t,
}: {
  onStateChange: (state: ProjectEntrySearchState) => void;
  query: string;
  search: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  t: Translate;
}): () => void {
  let cancelled = false;
  onStateChange({
    entries: [],
    loadError: '',
    loading: true,
  });
  void Promise.resolve()
    .then(() => search(query))
    .then((result) => {
      if (cancelled) return;
      onStateChange({
        entries: result.entries,
        loadError: result.truncated ? t('chat.composer.searchTruncated') : '',
        loading: false,
      });
    })
    .catch((unknownError: unknown) => {
      if (cancelled) return;
      onStateChange({
        entries: [],
        loadError: unknownError instanceof Error
          ? unknownError.message
          : t('chat.composer.projectLoadFailed'),
        loading: false,
      });
    });

  return () => {
    cancelled = true;
  };
}
