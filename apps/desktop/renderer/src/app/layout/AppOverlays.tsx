import type { DesktopRuntimeClient, RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RefObject } from 'react';
import type { DesktopNavigationState } from '../controller/useDesktopNavigation.js';
import { SidebarSearchOverlay } from '../sidebar/SidebarSearchOverlay.js';
import { RenameThreadDialog } from './RenameThreadDialog.js';

export function AppOverlays({
  client,
  navigation,
  projects,
  searchTriggerRef,
  threads,
}: {
  client: DesktopRuntimeClient;
  navigation: DesktopNavigationState;
  projects: WorkspaceProject[];
  searchTriggerRef: RefObject<HTMLButtonElement>;
  threads: RuntimeThreadSummary[];
}) {
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
          onLoadThread={(threadId) => client.getThread(threadId)}
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
    </>
  );
}
