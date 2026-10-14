import { createRoot } from 'react-dom/client';
import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';

export async function checkVideoPreview(workspaceRoot: string, file: WorkspaceFileRead) {
  const { default: Preview } = await import('../../src/features/workspace/media/WorkspaceVideoPreview.js');
  const root = createRoot(document.getElementById('document')!);
  root.render(<Preview workspaceRoot={workspaceRoot} file={file} />);
  try {
    await until(() => Boolean(document.querySelector('video')?.readyState));
    const video = document.querySelector('video')!;
    const decoded = video.videoWidth > 0 && video.duration > 0;
    const url = video.src;
    video.muted = true;
    await video.play();
    await until(() => video.currentTime > 0);
    const played = !video.paused;
    video.pause();
    const seekTime = video.duration / 2;
    video.currentTime = seekTime;
    await until(() => !video.seeking && Math.abs(video.currentTime - seekTime) < 0.1);
    return { decoded, played, seeked: true, url };
  } finally { root.unmount(); }
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Video did not become ready: ${document.querySelector('[role="alert"]')?.textContent ?? 'timeout'}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
