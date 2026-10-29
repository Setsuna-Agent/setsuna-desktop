// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SettingsPageLayout } from '../../../../src/shared/ui/SettingsPageLayout.js';

afterEach(cleanup);

it('restores the owning viewport after subpage navigation while preserving live reading positions', () => {
  const content = (title?: string, version = 0) => (
    <div data-testid="outer-page">
      <section data-testid="settings-viewport" data-settings-scroll-container="">
        {title ? <SettingsPageLayout title={title}><span>Settings version {version}</span></SettingsPageLayout> : 'Loading'}
      </section>
    </div>
  );
  const view = render(content());
  const outerPage = screen.getByTestId('outer-page');
  const viewport = screen.getByTestId('settings-viewport');
  outerPage.scrollTop = 400;
  viewport.scrollTop = 240;

  // Browser preferences arrive after the shared settings viewport is already mounted.
  view.rerender(content('Browser'));
  expect(viewport.scrollTop).toBe(0);
  expect(outerPage.scrollTop).toBe(400);

  viewport.scrollTop = 300;
  fireEvent.scroll(viewport);
  view.rerender(content('Browser', 1));
  expect(viewport.scrollTop).toBe(300);

  view.rerender(content('Saved passwords'));
  expect(viewport.scrollTop).toBe(0);
  viewport.scrollTop = 180;
  fireEvent.scroll(viewport);
  view.rerender(content('Browser'));
  expect(viewport.scrollTop).toBe(300);
  expect(outerPage.scrollTop).toBe(400);
});
