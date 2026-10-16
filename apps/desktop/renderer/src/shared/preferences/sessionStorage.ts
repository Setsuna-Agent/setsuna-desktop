import { useEffect, useMemo } from 'react';
import { readBrowserStorageValue, removeBrowserStorageValue, writeBrowserStorageValue } from './browserStorage.js';

const prefix = 'setsuna-desktop:session-v1:';
const maxRecordLength = 1_048_576;

function storageKey(windowKey: string, domain: string, identity: string): string {
  return `${prefix}${encodeURIComponent(windowKey)}:${domain}:${encodeURIComponent(identity)}`;
}

/** Each read addresses one visited conversation, never enumerating all saved sessions. */
export function readSessionRecord(windowKey: string | null, domain: string, identity: string): unknown {
  if (!windowKey) return null;
  const raw = readBrowserStorageValue(storageKey(windowKey, domain, identity));
  if (!raw || raw.length > maxRecordLength) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

export function writeSessionRecord(windowKey: string, domain: string, identity: string, value: unknown): void {
  const key = storageKey(windowKey, domain, identity);
  if (value === null) { removeBrowserStorageValue(key); return; }
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= maxRecordLength) writeBrowserStorageValue(key, raw);
    else removeBrowserStorageValue(key);
  } catch { /* Recovery is optional; unavailable storage must not interrupt editing. */ }
}

/** Coalesce typing and browser metadata updates; clear/send removes records immediately. */
export function useSessionWriter(windowKey: string | null, domain: string) {
  const writer = useMemo(() => {
    const pending = new Map<string, unknown>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (windowKey) for (const [identity, value] of pending) writeSessionRecord(windowKey, domain, identity, value);
      pending.clear();
    };
    return {
      flush,
      write(identity: string, value: unknown) {
        if (!windowKey) return;
        pending.set(identity, value);
        if (value === null) {
          pending.delete(identity);
          writeSessionRecord(windowKey, domain, identity, null);
        } else if (timer === undefined) timer = setTimeout(flush, 200);
      },
    };
  }, [domain, windowKey]);
  useEffect(() => {
    if (!windowKey) return undefined;
    const onHidden = () => { if (document.visibilityState === 'hidden') writer.flush(); };
    window.addEventListener('pagehide', writer.flush);
    window.addEventListener('beforeunload', writer.flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      writer.flush();
      window.removeEventListener('pagehide', writer.flush);
      window.removeEventListener('beforeunload', writer.flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [windowKey, writer]);
  return writer;
}
