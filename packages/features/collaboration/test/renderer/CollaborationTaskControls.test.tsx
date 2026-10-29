// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createNoopCollaborationRendererStateService } from '../../src/contracts/index.js';
import { CollaborationRendererProvider } from '../../src/renderer/context.js';
import { CollaborationTaskControls } from '../../src/renderer/CollaborationTaskControls.js';

afterEach(cleanup);

it('targets lifecycle controls at the observed child execution and reports stale-action failures', async () => {
  const act = vi.fn().mockRejectedValueOnce(new Error('Execution changed')).mockResolvedValue({ turnId: null });
  const onError = vi.fn();
  const service = { ...createNoopCollaborationRendererStateService(), available: true, act };
  const panel = (turnId: string | null) => <CollaborationRendererProvider service={service}>
    <CollaborationTaskControls parentThreadId="parent" childThreadId="child" activeTurnId={turnId} translate={(key) => key} onError={onError} />
  </CollaborationRendererProvider>;
  const view = render(panel('running'));
  fireEvent.click(view.getByRole('button', { name: 'feature.collaboration.panel.interrupt' }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith('Execution changed'));
  expect(act).toHaveBeenLastCalledWith({ threadId: 'parent', childThreadId: 'child', action: 'interrupt', expectedTurnId: 'running' });
  view.rerender(panel(null));
  fireEvent.click(view.getByRole('button', { name: 'feature.collaboration.panel.stopTracking' }));
  await waitFor(() => expect(act).toHaveBeenLastCalledWith({ threadId: 'parent', childThreadId: 'child', action: 'close', expectedTurnId: null }));
});
