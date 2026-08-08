import {
  browserLocalStorage,
  readStorageValue,
  removeStorageValue,
  writeStorageValue,
} from '../../../shared/preferences/browserStorage.js';

export const DESKTOP_WORKSPACE_APP_STORAGE_KEY = 'setsuna-agent:desktop-workspace-app';

type WorkspaceAppPreferenceReader = Pick<Storage, 'getItem'>;
type WorkspaceAppPreferenceWriter = Pick<Storage, 'removeItem' | 'setItem'>;

export function readPreferredWorkspaceAppId(
  storage: WorkspaceAppPreferenceReader | null = browserLocalStorage(),
): string {
  return readStorageValue(storage, DESKTOP_WORKSPACE_APP_STORAGE_KEY)?.trim() ?? '';
}

export function writePreferredWorkspaceAppId(
  appId: string,
  storage: WorkspaceAppPreferenceWriter | null = browserLocalStorage(),
): void {
  if (!storage) return;
  const value = appId.trim();
  if (value) {
    writeStorageValue(storage, DESKTOP_WORKSPACE_APP_STORAGE_KEY, value);
    return;
  }
  removeStorageValue(storage, DESKTOP_WORKSPACE_APP_STORAGE_KEY);
}
