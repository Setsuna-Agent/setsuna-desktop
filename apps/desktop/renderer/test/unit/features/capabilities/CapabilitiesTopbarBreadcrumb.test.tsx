// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesTopbarBreadcrumb } from '../../../../src/features/capabilities/CapabilitiesTopbarBreadcrumb.js';
import { appRouteTopbarSlotId } from '../../../../src/shared/ui/AppRouteTopbarPortal.js';

afterEach(() => {
  cleanup();
  document.getElementById(appRouteTopbarSlotId)?.remove();
});

describe('CapabilitiesTopbarBreadcrumb', () => {
  it('renders in the route topbar and returns through the parent entry', async () => {
    const target = document.createElement('div');
    target.id = appRouteTopbarSlotId;
    document.body.append(target);
    const onBack = vi.fn();

    render(
      <CapabilitiesTopbarBreadcrumb
        currentLabel="Word 文档处理"
        parentLabel="插件"
        onBack={onBack}
      />,
    );

    expect(screen.getByRole('navigation', { name: '插件 / Word 文档处理' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '插件' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
