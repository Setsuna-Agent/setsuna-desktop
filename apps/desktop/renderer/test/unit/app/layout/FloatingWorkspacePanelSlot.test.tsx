// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingWorkspacePanelSlot } from '../../../../src/app/layout/FloatingWorkspacePanelSlot.js';

afterEach(cleanup);

describe('FloatingWorkspacePanelSlot', () => {
  it('keeps its child mounted when placement changes', () => {
    const onUnmount = vi.fn();
    const view = render(
      <FloatingWorkspacePanelSlot placement="side">
        <MountedPanel onUnmount={onUnmount} />
      </FloatingWorkspacePanelSlot>,
    );
    const mountedPanel = screen.getByTestId('mounted-panel');

    view.rerender(
      <FloatingWorkspacePanelSlot placement="bottom">
        <MountedPanel onUnmount={onUnmount} />
      </FloatingWorkspacePanelSlot>,
    );

    expect(screen.getByTestId('mounted-panel')).toBe(mountedPanel);
    expect(onUnmount).not.toHaveBeenCalled();
  });
});

function MountedPanel({ onUnmount }: { onUnmount: () => void }) {
  useEffect(() => onUnmount, [onUnmount]);
  return <aside data-testid="mounted-panel" />;
}
