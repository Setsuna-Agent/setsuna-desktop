import { createContext, useContext, type ReactNode } from 'react';
import type { RuntimeThread } from '@setsuna-desktop/contracts';

const ChatThreadIdContext = createContext<string | null>(null);
const ChatThreadFileChangesContext = createContext<RuntimeThread['fileChangeStates']>(undefined);
const ChatThreadFileChangeGroupsContext = createContext<RuntimeThread['fileChangeGroups']>(undefined);

export function ChatThreadProvider({
  children,
  threadId,
  fileChangeStates,
  fileChangeGroups,
}: {
  children: ReactNode;
  threadId: string | null;
  fileChangeStates?: RuntimeThread['fileChangeStates'];
  fileChangeGroups?: RuntimeThread['fileChangeGroups'];
}) {
  return <ChatThreadIdContext.Provider value={threadId}>
    <ChatThreadFileChangesContext.Provider value={fileChangeStates}>
      <ChatThreadFileChangeGroupsContext.Provider value={fileChangeGroups}>{children}</ChatThreadFileChangeGroupsContext.Provider>
    </ChatThreadFileChangesContext.Provider>
  </ChatThreadIdContext.Provider>;
}

export function useChatThreadId(): string | null {
  return useContext(ChatThreadIdContext);
}

export function useChatThreadFileChangeStates() {
  return useContext(ChatThreadFileChangesContext);
}

export function useChatThreadFileChangeGroups() { return useContext(ChatThreadFileChangeGroupsContext); }
