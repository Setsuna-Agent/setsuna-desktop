// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesTopbarBreadcrumb } from '../../../../src/features/capabilities/CapabilitiesTopbarBreadcrumb.js';
import { appRouteTopbarSlotId } from '../../../../src/shared/ui/AppRouteTopbarPortal.js';

afterEach(() => {
  cleanup();
  document.getElementById(appRouteTopbarSlotId)?.remove();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

describe('CapabilitiesTopbarBreadcrumb', () => {
  it('renders inside the page on Windows and returns through the parent entry', async () => {
    Object.defineProperty(window, 'setsunaDesktop', {
      configurable: true,
      value: { desktop: { platform: 'win32' } },
    });
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

    const breadcrumb = screen.getByRole('navigation', { name: '插件 / Word 文档处理' });
    expect(target.contains(breadcrumb)).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '插件' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('keeps the breadcrumb in the route topbar on macOS', () => {
    Object.defineProperty(window, 'setsunaDesktop', {
      configurable: true,
      value: { desktop: { platform: 'darwin' } },
    });
    const target = document.createElement('div');
    target.id = appRouteTopbarSlotId;
    document.body.append(target);

    render(
      <CapabilitiesTopbarBreadcrumb
        currentLabel="Word 文档处理"
        parentLabel="插件"
        onBack={vi.fn()}
      />,
    );

    const breadcrumb = screen.getByRole('navigation', { name: '插件 / Word 文档处理' });
    expect(target.contains(breadcrumb)).toBe(true);
  });
});
