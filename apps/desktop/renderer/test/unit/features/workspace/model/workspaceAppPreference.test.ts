import { describe, expect, it } from 'vitest';
import {
  DESKTOP_WORKSPACE_APP_STORAGE_KEY,
  readPreferredWorkspaceAppId,
  writePreferredWorkspaceAppId,
} from '../../../../../src/features/workspace/model/workspaceAppPreference.js';

describe('workspace app preference', () => {
  it('reads and writes the pc-compatible preferred workspace app id', () => {
    const storage = new MemoryStorage();

    writePreferredWorkspaceAppId('  pycharm  ', storage);

    expect(storage.getItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY)).toBe('pycharm');
    expect(readPreferredWorkspaceAppId(storage)).toBe('pycharm');
  });

  it('removes the preference when the selected app id is empty', () => {
    const storage = new MemoryStorage();
    storage.setItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY, 'vscode');

    writePreferredWorkspaceAppId('   ', storage);

    expect(storage.getItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY)).toBeNull();
    expect(readPreferredWorkspaceAppId(storage)).toBe('');
  });
});

class MemoryStorage implements Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
