import type { RuntimeMcpDeviceAuthorization } from '@setsuna-desktop/contracts';
import { useRef, useState } from 'react';

/** Copy and browser launch happen only in response to an explicit user action. */
export function useMcpDeviceAuthorization(
  challenge: RuntimeMcpDeviceAuthorization | undefined,
  openExternal: (url: string) => Promise<boolean>,
) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<'copy' | 'open' | null>(null);

  const copy = async (): Promise<boolean> => {
    if (!challenge) return false;
    try {
      await navigator.clipboard.writeText(challenge.userCode);
      setCopied(true);
      setError(null);
      return true;
    } catch {
      setError('copy');
      return false;
    }
  };
  const open = async () => {
    if (!challenge || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      // If copying fails, keep the user beside the selectable code instead of opening an empty form.
      if (!await copy()) return;
      if (!await openExternal(challenge.verificationUri).catch(() => false)) setError('open');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { copied: error !== 'copy' && copied, pending, error, copy, open };
}
