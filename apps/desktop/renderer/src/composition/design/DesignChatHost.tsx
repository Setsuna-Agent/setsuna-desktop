import { createContext, lazy, Suspense, useContext } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesignChatBinding, DesignClient } from '@setsuna-desktop/feature-design/renderer';
import type { DesktopAppController } from '../../app/controller/useDesktopAppController.js';

const Sidebar = lazy(() => import('./DesignChatSidebar.js'));
export type DesignChatRuntime = Pick<DesktopAppController['runtime'], 'client' | 'config' | 'saveRuntimePreferences' | 'selectConversationModel'>;
type Host = { projects: readonly WorkspaceProject[]; fileWorkspace?: WorkspaceProject; runtime: DesignChatRuntime; conversations?: DesignClient['conversations'] };
export const DesignChatHost = createContext<Host | null>(null);
export const DesignRouteBusyContext = createContext<((busy: boolean) => void) | undefined>(undefined);

export function useDesignChat(projectId: string | undefined) {
  const host = useContext(DesignChatHost);
  if (!host || !host.conversations) return undefined;
  const { projects, fileWorkspace, conversations, runtime } = host;
  return (binding: DesignChatBinding, linkedId: string | null | undefined = projectId) => {
    const project = projects.find(({ id }) => id === linkedId) ?? (fileWorkspace?.id === linkedId ? fileWorkspace : undefined);
    return <Suspense fallback={null}><Sidebar binding={binding} conversations={conversations} project={project} runtime={runtime} /></Suspense>;
  };
}
