import { lazy, Suspense } from 'react';
import type { useConversationExportPreview } from './useConversationExportPreview.js';

const ConversationExportDialog = lazy(() => import('./ConversationExportDialog.js'));

export function ConversationExportOverlay({ state, onClose }: {
  state: ReturnType<typeof useConversationExportPreview>['state'];
  onClose: () => void;
}) {
  if (!state) return null;
  return <Suspense fallback={null}>
    <ConversationExportDialog key={state.id} preview={state.preview} onClose={onClose} />
  </Suspense>;
}
