import type { SandboxDialogSession } from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';

export function useSandboxDialogSession(title: string) {
  const desktop = window.setsunaDesktop?.desktop;
  const create = desktop?.createSandboxDialogSession;
  const release = desktop?.releaseSandboxDialogSession;
  const update = desktop?.updateSandboxDialogSession;
  const initialTitle = useRef(title);
  const [state, setState] = useState<{ session?: SandboxDialogSession; error?: string }>();
  useEffect(() => {
    if (!create || !release) return;
    let disposed = false;
    let session: SandboxDialogSession | undefined;
    void create(initialTitle.current.slice(0, 512)).then((value) => {
      session = value;
      if (disposed) void release(value.id).catch(console.error);
      else setState({ session: value });
    }).catch((error: unknown) => {
      if (!disposed) setState({ error: error instanceof Error ? error.message : 'Desktop dialogs are unavailable.' });
    });
    return () => {
      disposed = true;
      if (session) void release(session.id).catch(console.error);
    };
  }, [create, release]);
  const sessionId = state?.session?.id;
  useEffect(() => {
    // Titles are presentation metadata. Replacing the capability URL reloads
    // the iframe and discards its unsaved form state.
    if (sessionId && update) void update(sessionId, title.slice(0, 512)).catch(console.error);
  }, [sessionId, title, update]);
  return { ready: !create || !release || Boolean(state), url: state?.session?.url, error: state?.error };
}
