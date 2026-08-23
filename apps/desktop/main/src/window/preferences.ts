import type { DesktopWindowCloseBehavior } from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import { writeJsonAtomically } from '../data-root/atomic-json.js';

const desktopWindowPreferencesVersion = 1;
const defaultCloseBehavior: DesktopWindowCloseBehavior = 'quit';

export interface DesktopWindowPreferencesPersistence {
  load(): Promise<DesktopWindowCloseBehavior>;
  save(closeBehavior: DesktopWindowCloseBehavior): Promise<void>;
}

export class DesktopWindowPreferencesStore implements DesktopWindowPreferencesPersistence {
  constructor(private readonly filePath: string) {}

  async load(): Promise<DesktopWindowCloseBehavior> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      return normalizeDesktopWindowPreferences(value);
    } catch {
      return defaultCloseBehavior;
    }
  }

  async save(closeBehavior: DesktopWindowCloseBehavior): Promise<void> {
    await writeJsonAtomically(this.filePath, {
      version: desktopWindowPreferencesVersion,
      closeBehavior,
    });
  }
}

export function normalizeDesktopWindowPreferences(value: unknown): DesktopWindowCloseBehavior {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultCloseBehavior;
  const record = value as Record<string, unknown>;
  if (record.version !== desktopWindowPreferencesVersion) return defaultCloseBehavior;
  return record.closeBehavior === 'hide-to-tray' ? 'hide-to-tray' : defaultCloseBehavior;
}
