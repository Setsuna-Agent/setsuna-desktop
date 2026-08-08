// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebviewTag } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { BrowserPanel } from '../../../../src/features/workspace/BrowserPanel.js';
import { createBrowserPanel } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BrowserPanel interactions', () => {
  it('commits the requested zoom only after the webview accepts it', async () => {
    const setZoomFactor = vi.fn();
    renderBrowserPanel();
    installZoomMethods(setZoomFactor);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Zoom in' }));

    expect(setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' }).textContent).toBe('110%');
  });

  it('keeps the last confirmed zoom and reports a rejected webview action', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setZoomFactor = vi.fn(() => { throw new Error('detached'); });
    renderBrowserPanel();
    installZoomMethods(setZoomFactor);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Zoom in' }));

    expect(setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' }).textContent).toBe('100%');
    expect(screen.getByText('Could not change the current page zoom')).toBeTruthy();
  });
});

function renderBrowserPanel() {
  const panel = createBrowserPanel('browser-interaction', 'https://example.com');
  if (panel.browser) panel.browser.loading = false;
  return render(
    <I18nProvider initialLocale="en-US">
      <ToastProvider>
        <BrowserPanel
          hidden={false}
          panel={panel}
          resizeMax={960}
          resizeMin={320}
          resizeValue={640}
          onPanelMetadataChange={() => undefined}
          onResizeStart={() => undefined}
          onResizeStep={() => undefined}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

function installZoomMethods(setZoomFactor: (value: number) => void): WebviewTag {
  const webview = document.querySelector('webview') as unknown as WebviewTag;
  Object.assign(webview, {
    getZoomFactor: () => 1,
    setZoomFactor,
  });
  return webview;
}
