import { createContext, useContext, type ReactNode } from 'react';

const ChatThreadIdContext = createContext<string | null>(null);

export function ChatThreadProvider({
  children,
  threadId,
}: {
  children: ReactNode;
  threadId: string | null;
}) {
  return <ChatThreadIdContext.Provider value={threadId}>{children}</ChatThreadIdContext.Provider>;
}

export function useChatThreadId(): string | null {
  return useContext(ChatThreadIdContext);
}
