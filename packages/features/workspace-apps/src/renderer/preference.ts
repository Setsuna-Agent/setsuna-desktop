export const DESKTOP_WORKSPACE_APP_STORAGE_KEY = 'setsuna-agent:desktop-workspace-app';

type WorkspaceAppPreferenceReader = Pick<Storage, 'getItem'>;
type WorkspaceAppPreferenceWriter = Pick<Storage, 'removeItem' | 'setItem'>;

export function readPreferredWorkspaceAppId(
  storage: WorkspaceAppPreferenceReader | null = browserLocalStorage(),
): string {
  if (!storage) return '';
  try {
    return storage.getItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function writePreferredWorkspaceAppId(
  appId: string,
  storage: WorkspaceAppPreferenceWriter | null = browserLocalStorage(),
): void {
  if (!storage) return;
  const value = appId.trim();
  try {
    if (value) {
      storage.setItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY, value);
      return;
    }
    storage.removeItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY);
  } catch {
    // Browser storage may be unavailable under a hardened renderer policy.
  }
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
