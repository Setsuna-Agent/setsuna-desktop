import type { DesktopRuntimeClient, RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RefObject } from 'react';
import { RuntimeActivityFeatureCenter } from '../../composition/RuntimeActivityFeatureBoundary.js';
import type { DesktopNavigationState } from '../controller/useDesktopNavigation.js';
import { SidebarSearchOverlay } from '../sidebar/SidebarSearchOverlay.js';
import type { SidebarSearchActionHandlers } from '../sidebar/useSidebarSearchActions.js';
import type { SidebarSearchFileTarget } from '../sidebar/sidebarSearchTypes.js';
import { RenameThreadDialog } from './RenameThreadDialog.js';
import { ProjectEditorDialog } from './ProjectEditorDialog.js';

export function AppOverlays({
  client,
  searchActions,
  onOpenSearchFile,
  navigation,
  projects,
  runtimeActivityOpen,
  runtimeActivityTriggerRef,
  threads,
  onActivitiesChanged,
  onCloseRuntimeActivity,
  onOpenThread,
}: {
  client: DesktopRuntimeClient;
  searchActions: SidebarSearchActionHandlers;
  onOpenSearchFile(target: SidebarSearchFileTarget): Promise<void>;
  navigation: DesktopNavigationState;
  projects: WorkspaceProject[];
  runtimeActivityOpen: boolean;
  runtimeActivityTriggerRef: RefObject<HTMLButtonElement>;
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
      {navigation.sidebarSearchTarget ? (
        <SidebarSearchOverlay
          actions={searchActions}
          activeProjectId={navigation.sidebarSearchTarget.projectId}
          initialCategory={navigation.sidebarSearchTarget.category}
          client={client}
          projects={projects}
          query={navigation.sidebarSearchValue}
          threads={threads}
          onChange={navigation.setSidebarSearchValue}
          onClose={navigation.closeSidebarSearch}
          onSelectThread={navigation.selectThread}
          onSelectFile={onOpenSearchFile}
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
          projects={projects}
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
