import { normalizeWorkspaceSearchExtensions, type DesktopRuntimeClient, type RuntimeThreadSummary, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue.js';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { runtimeClientErrorMessage } from '../../services/runtime-client/runtimeClientErrors.js';
import { useToast } from '../providers/ToastProvider.js';
import { buildSidebarSearchResults } from './sidebarSearchResults.js';
import { searchSidebarWorkspace } from './searchSidebarWorkspace.js';
import type { SidebarSearchCategory, SidebarWorkspaceSearchResult } from './sidebarSearchTypes.js';

export function useSidebarSearch({ client, query, category, project, extensions, projects, threads }: {
  client: DesktopRuntimeClient;
  query: string;
  category: SidebarSearchCategory;
  project?: WorkspaceProject;
  extensions: string;
  projects: WorkspaceProject[];
  threads: RuntimeThreadSummary[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const keyword = query.trim();
  const debouncedKeyword = useDebouncedValue(keyword, 200);
  const debouncedExtensions = useDebouncedValue(extensions, 200);
  const searchThreads = category === 'all' || category === 'threads';
  const threadKey = JSON.stringify([keyword, searchThreads]);
  const threadGuard = useIdentityRequestGuard(threadKey);
  const [threadState, setThreadState] = useState<{ key: string; results: RuntimeThreadSummary[]; failed: boolean } | null>(null);
  const workspaceKey = JSON.stringify([keyword, category, project, extensions]);
  const workspaceGuard = useIdentityRequestGuard(workspaceKey);
  const [workspaceState, setWorkspaceState] = useState<{ key: string; results: SidebarWorkspaceSearchResult[]; failed: boolean } | null>(null);
  const searchWorkspace = Boolean(project && (category === 'files' || (keyword && (category === 'all' || category === 'text'))));

  useEffect(() => {
    if (!searchThreads || !keyword || debouncedKeyword !== keyword) return;
    const isCurrent = threadGuard.begin();
    void client.listThreads({ search: keyword, scope: 'all', includeArchived: true, includeFeatures: true }).then((response) => {
      if (isCurrent()) setThreadState({ key: threadKey, results: response.threads, failed: false });
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      setThreadState({ key: threadKey, results: [], failed: true });
      toast.error(runtimeClientErrorMessage(error));
    });
    return () => threadGuard.invalidate();
  }, [client, debouncedKeyword, keyword, searchThreads, threadGuard, threadKey, toast]);

  useEffect(() => {
    if (!searchWorkspace || !project || debouncedKeyword !== keyword || debouncedExtensions !== extensions) return;
    const isCurrent = workspaceGuard.begin();
    let fileExtensions: string[];
    try {
      fileExtensions = normalizeWorkspaceSearchExtensions(category === 'text' ? [extensions] : []);
    } catch {
      setWorkspaceState({ key: workspaceKey, results: [], failed: true });
      return;
    }
    void searchSidebarWorkspace(client, project, keyword, category, fileExtensions, isCurrent).then(({ results, errors }) => {
      if (!isCurrent()) return;
      setWorkspaceState({ key: workspaceKey, results, failed: errors.length > 0 });
      if (errors.length) toast.error(runtimeClientErrorMessage(errors[0]));
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      setWorkspaceState({ key: workspaceKey, results: [], failed: true });
      toast.error(runtimeClientErrorMessage(error));
    });
    return () => workspaceGuard.invalidate();
  }, [category, client, debouncedExtensions, debouncedKeyword, extensions, keyword, project, searchWorkspace, toast, workspaceGuard, workspaceKey]);

  // Hide previous results during render, before effects can clear an obsolete query or project.
  const matchingThreads = keyword ? threadState?.key === threadKey ? threadState.results : [] : threads;
  const workspaceResults = searchWorkspace && workspaceState?.key === workspaceKey ? workspaceState.results : [];
  return {
    threads: searchThreads ? buildSidebarSearchResults({
      projectFallback: t('sidebar.projectFallback'), projectNameById: new Map(projects.map((item) => [item.id, item.name])),
      query: keyword, threads: matchingThreads,
    }) : [],
    files: workspaceResults.filter((result) => result.kind === 'files').slice(0, 80),
    text: workspaceResults.filter((result) => result.kind === 'text').slice(0, 100),
    loading: Boolean((searchThreads && keyword && threadState?.key !== threadKey) || (searchWorkspace && workspaceState?.key !== workspaceKey)),
    failed: Boolean((threadState?.key === threadKey && threadState.failed) || (workspaceState?.key === workspaceKey && workspaceState.failed)),
  };
}
