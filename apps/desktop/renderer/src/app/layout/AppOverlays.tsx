import type { DesktopRuntimeClient, RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RefObject } from 'react';
import { RuntimeActivityFeatureCenter } from '../../composition/RuntimeActivityFeatureBoundary.js';
import type { DesktopNavigationState } from '../controller/useDesktopNavigation.js';
import { SidebarSearchOverlay } from '../sidebar/SidebarSearchOverlay.js';
import { RenameThreadDialog } from './RenameThreadDialog.js';
import { ProjectEditorDialog } from './ProjectEditorDialog.js';

export function AppOverlays({
  client,
  navigation,
  projects,
  runtimeActivityOpen,
  runtimeActivityTriggerRef,
  searchTriggerRef,
  threads,
  onActivitiesChanged,
  onCloseRuntimeActivity,
  onOpenThread,
}: {
  client: DesktopRuntimeClient;
  navigation: DesktopNavigationState;
  projects: WorkspaceProject[];
  runtimeActivityOpen: boolean;
  runtimeActivityTriggerRef: RefObject<HTMLButtonElement>;
  searchTriggerRef: RefObject<HTMLButtonElement>;
  threads: RuntimeThreadSummary[];
  onActivitiesChanged: () => unknown;
  onCloseRuntimeActivity: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  const projectEditorProject = navigation.projectEditor?.mode === 'edit'
    ? navigation.projectEditor.project
    : null;
  return (
    <>
      {navigation.sidebarSearchOpen ? (
        <SidebarSearchOverlay
          projects={projects}
          query={navigation.sidebarSearchValue}
          returnFocusRef={searchTriggerRef}
          threads={threads}
          onChange={navigation.setSidebarSearchValue}
          onClose={() => navigation.setSidebarSearchOpen(false)}
          onSearchThreads={client.listThreads}
          onSelect={(threadId) => {
            navigation.setSidebarSearchOpen(false);
            navigation.setSidebarSearchValue('');
            void navigation.selectThread(threadId);
          }}
        />
      ) : null}
      {navigation.renamingThread ? (
        <RenameThreadDialog
          title={navigation.renameThreadTitle}
          onCancel={navigation.closeRenameThread}
          onChange={navigation.setRenameThreadTitle}
          onSave={() => void navigation.saveRenameThread()}
        />
      ) : null}
      {navigation.projectEditor ? (
        <ProjectEditorDialog
          key={projectEditorProject?.id ?? 'new-project'}
          project={projectEditorProject}
          onClose={navigation.closeProjectEditor}
          onRemove={navigation.removeProject}
          onSave={navigation.saveProject}
        />
      ) : null}
      {runtimeActivityOpen ? (
        <RuntimeActivityFeatureCenter
          projects={projects}
          returnFocusRef={runtimeActivityTriggerRef}
          onActivitiesChanged={onActivitiesChanged}
          onClose={onCloseRuntimeActivity}
          onOpenThread={onOpenThread}
        />
      ) : null}
    </>
  );
}
