import { createContext, useContext, type ReactNode } from 'react';

export type ApproveDeniedActionHandler = (
  approvalId: string,
) => void | Promise<void>;

const ApproveDeniedActionContext = createContext<ApproveDeniedActionHandler | null>(null);

export function RuntimeApprovalActionsProvider({
  children,
  onApproveDeniedAction,
}: {
  children: ReactNode;
  onApproveDeniedAction: ApproveDeniedActionHandler;
}) {
  return (
    <ApproveDeniedActionContext.Provider value={onApproveDeniedAction}>
      {children}
    </ApproveDeniedActionContext.Provider>
  );
}

export function useApproveDeniedAction(): ApproveDeniedActionHandler | null {
  return useContext(ApproveDeniedActionContext);
}
