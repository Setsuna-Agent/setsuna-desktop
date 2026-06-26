export const DESKTOP_WORKSPACE_APP_STORAGE_KEY = 'setsuna-agent:desktop-workspace-app';

type WorkspaceAppPreferenceReader = Pick<Storage, 'getItem'>;
type WorkspaceAppPreferenceWriter = Pick<Storage, 'removeItem' | 'setItem'>;

export function readPreferredWorkspaceAppId(storage = browserStorage()): string {
  return storage?.getItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY)?.trim() ?? '';
}

export function writePreferredWorkspaceAppId(appId: string, storage = browserStorage()): void {
  if (!storage) return;
  const value = appId.trim();
  if (value) {
    storage.setItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY, value);
    return;
  }
  storage.removeItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY);
}

function browserStorage(): (WorkspaceAppPreferenceReader & WorkspaceAppPreferenceWriter) | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
