import { useCallback, useEffect, useRef, useState } from 'react';

type FullscreenRequest = { entered: boolean; exiting: boolean };

function exitPresentationFullscreen(request: FullscreenRequest) {
  if (request.exiting || document.fullscreenElement !== document.documentElement) return;
  request.exiting = true;
  void document.exitFullscreen().catch(() => undefined);
}

export function useDesignPrototypeSession(visible: boolean) {
  const [start, setStart] = useState<string>();
  const fullscreen = useRef<FullscreenRequest>();
  const releaseFullscreen = useCallback(() => {
    const request = fullscreen.current;
    fullscreen.current = undefined;
    if (request) exitPresentationFullscreen(request);
  }, []);

  const close = useCallback(() => {
    setStart(undefined);
    releaseFullscreen();
  }, [releaseFullscreen]);

  useEffect(() => releaseFullscreen, [releaseFullscreen]);
  useEffect(() => { if (!visible) close(); }, [close, visible]);
  useEffect(() => {
    if (!start) return;
    const onFullscreenChange = () => {
      const request = fullscreen.current;
      if (!request) return;
      if (document.fullscreenElement === document.documentElement) request.entered = true;
      else if (request.entered) close();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [close, start]);

  function play(board: string) {
    setStart(board);
    const root = document.documentElement;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    const request = { entered: false, exiting: false };
    fullscreen.current = request;
    // Request from the click and include the shared menu portal in fullscreen.
    void root.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      if (fullscreen.current === request) request.entered = document.fullscreenElement === root;
      else if (!fullscreen.current) exitPresentationFullscreen(request);
    }, () => {
      if (fullscreen.current === request) fullscreen.current = undefined;
    });
  }

  return { start: visible ? start : undefined, play, close };
}
