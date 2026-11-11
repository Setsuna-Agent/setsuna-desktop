import type { WorkspaceEntry, WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { useEffect, useState } from 'react';
import { mergeProjectEntries, searchItemToWorkspaceEntry } from '../workspaceFileTree.js';

export type SearchWorkspaceEntries = (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;

/** Popover-local reads never change the explorer's search, selection, or expansion. */
export function useWorkspaceBreadcrumbDirectory(directory: string, searchEntries: SearchWorkspaceEntries) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const toast = useToast();
  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    void searchEntries('', directory).then((result) => {
      if (!cancelled) setEntries(mergeProjectEntries([], result.entries.map(searchItemToWorkspaceEntry)));
    }).catch((error: unknown) => {
      if (cancelled) return;
      setEntries([]);
      toast.error(error instanceof Error ? error.message : String(error));
    });
    // Closing the popup or changing workspace retires all of its pending directory reads.
    return () => { cancelled = true; };
  }, [directory, searchEntries, toast]);
  return entries;
}
