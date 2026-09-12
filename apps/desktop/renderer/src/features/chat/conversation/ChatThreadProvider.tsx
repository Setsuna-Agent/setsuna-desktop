import { createContext, useContext, type ReactNode } from 'react';
import type { RuntimeThread } from '@setsuna-desktop/contracts';

const ChatThreadIdContext = createContext<string | null>(null);
const ChatThreadFileChangesContext = createContext<RuntimeThread['fileChangeStates']>(undefined);

export function ChatThreadProvider({
  children,
  threadId,
  fileChangeStates,
}: {
  children: ReactNode;
  threadId: string | null;
  fileChangeStates?: RuntimeThread['fileChangeStates'];
}) {
  return <ChatThreadIdContext.Provider value={threadId}>
    <ChatThreadFileChangesContext.Provider value={fileChangeStates}>{children}</ChatThreadFileChangesContext.Provider>
  </ChatThreadIdContext.Provider>;
}

export function useChatThreadId(): string | null {
  return useContext(ChatThreadIdContext);
}

export function useChatThreadFileChangeStates() {
  return useContext(ChatThreadFileChangesContext);
}
