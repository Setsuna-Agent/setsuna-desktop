import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';

export function useWorkspaceVideoPreview(file: WorkspaceFileRead, workspaceRoot?: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { path: filePath, revision } = file;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const desktop = window.setsunaDesktop?.desktop;
    let active = true;
    let previewId: string | undefined;
    setError(null);
    const release = (id: string) => { void desktop?.releaseWorkspaceFilePreview(id).catch(() => undefined); };
    const onError = () => setError(video.error?.message || 'Video playback failed.');
    video.addEventListener('error', onError);

    void (async () => {
      if (!desktop || !workspaceRoot) throw new Error('Workspace is unavailable.');
      const result = await desktop.createWorkspaceFilePreview(workspaceRoot, filePath);
      if (!result.ok) throw new Error(result.error);
      // An IPC response can arrive after switching tabs; never attach that stale stream.
      if (!active) { release(result.previewId); return; }
      previewId = result.previewId;
      video.src = result.url;
    })().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Video playback failed.');
    });

    return () => {
      active = false;
      video.removeEventListener('error', onError);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (previewId) release(previewId);
    };
  }, [filePath, workspaceRoot, revision]);

  return { videoRef, error };
}
