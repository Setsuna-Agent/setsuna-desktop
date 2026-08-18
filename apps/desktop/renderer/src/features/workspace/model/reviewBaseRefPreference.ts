import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import {
  readBrowserStorageValue,
  removeBrowserStorageValue,
  writeBrowserStorageValue,
} from '../../../shared/preferences/browserStorage.js';

export function reviewBaseRefPreferenceKey(project: WorkspaceProject): string {
  return `setsuna-desktop:review-base-ref:${project.id || project.path}`;
}

export function readReviewBaseRefPreference(key: string | null): string | null {
  if (!key) return null;
  return readBrowserStorageValue(key)?.trim() || null;
}

export function writeReviewBaseRefPreference(key: string, baseRef: string | null): void {
  if (baseRef) writeBrowserStorageValue(key, baseRef);
  else removeBrowserStorageValue(key);
}

export function normalizeReviewBaseRefPreference(
  baseRef: string | null,
  availableBaseRefs: string[],
): string | null {
  const preferred = baseRef?.trim();
  if (!preferred) return null;
  if (isRemoteBaseRef(preferred) && availableBaseRefs.includes(preferred)) return preferred;

  const logicalName = logicalBaseRefName(preferred);
  if (!logicalName) return null;
  for (const remote of ['origin', 'upstream']) {
    const remoteRef = `${remote}/${logicalName}`;
    if (availableBaseRefs.includes(remoteRef)) return remoteRef;
  }
  return availableBaseRefs.includes(preferred) ? preferred : null;
}

function logicalBaseRefName(baseRef: string): string {
  for (const remote of ['origin/', 'upstream/']) {
    if (baseRef.startsWith(remote)) return baseRef.slice(remote.length);
  }
  return baseRef;
}

function isRemoteBaseRef(baseRef: string): boolean {
  return baseRef.startsWith('origin/') || baseRef.startsWith('upstream/');
}
