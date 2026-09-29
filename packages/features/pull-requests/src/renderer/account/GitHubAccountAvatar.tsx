import { useState, useSyncExternalStore } from 'react';
import type { ShellRegionSlotProps } from '@setsuna-desktop/renderer-contracts/shell';
import type { PullRequestConnectionState } from './connection-state.js';

export function GitHubAccountAvatar({ state, renderDefault }: ShellRegionSlotProps & {
  state: PullRequestConnectionState;
}) {
  const { connection, error } = useSyncExternalStore(state.subscribe, state.getSnapshot);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const avatarUrl = !error && connection?.state === 'connected' ? connection.avatarUrl : null;
  if (!avatarUrl || avatarUrl === failedUrl) return renderDefault();

  return <img src={avatarUrl} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailedUrl(avatarUrl)} />;
}
