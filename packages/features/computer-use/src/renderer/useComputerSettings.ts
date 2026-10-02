import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComputerBridge, ComputerPermission, ComputerSettings } from '../contracts/index.js';

export function useComputerSettings(bridge: ComputerBridge) {
  const [settings, setSettings] = useState<ComputerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState<ComputerPermission | null>(null);
  const mounted = useRef(false);
  const writing = useRef(false);
  const permissionPending = useRef(false);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    if (writing.current) return;
    const id = ++request.current;
    try {
      const value = await bridge.settings();
      if (mounted.current && id === request.current) { setSettings(value); setError(null); }
    } catch (cause) {
      if (mounted.current && id === request.current) setError(String(cause));
    }
  }, [bridge]);

  const setEnabled = async (enabled: boolean) => {
    if (writing.current) return;
    writing.current = true;
    ++request.current; // An earlier focus refresh must not overwrite this save.
    setSaving(true);
    setError(null);
    try {
      const value = await bridge.setEnabled(enabled);
      if (mounted.current) setSettings(value);
    } catch (cause) {
      // Disabling takes effect even if persistence fails; read the actual main state.
      const value = await bridge.settings().catch(() => null);
      if (mounted.current) { if (value) setSettings(value); setError(String(cause)); }
    } finally {
      writing.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const requestPermission = async (permission: ComputerPermission) => {
    if (permissionPending.current) return;
    permissionPending.current = true;
    setRequesting(permission);
    setError(null);
    try {
      await bridge.requestPermission(permission);
      await refresh();
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      permissionPending.current = false;
      if (mounted.current) setRequesting(null);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const onFocus = () => { void refresh(); };
    onFocus();
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; ++request.current; window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  return { settings, saving, requesting, error, refresh, setEnabled, requestPermission };
}
