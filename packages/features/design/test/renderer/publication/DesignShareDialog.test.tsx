// @vitest-environment happy-dom

import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesignPreviewAccess, DesignPublishedPreview } from '../../../src/contracts/design-publication.js';
import { DesignUiHostContext } from '../../../src/renderer/context/design-ui-host.js';
import { DesignShareDialog } from '../../../src/renderer/publication/DesignShareDialog.js';
import { designPublicationMessages } from '../../../src/renderer/publication/design-publication-messages.js';

afterEach(cleanup);

const messages: Readonly<Record<string, string>> = { ...designPublicationMessages['en-US'], 'feature.design.cancel': 'Cancel' };
const translate: RendererTranslate = (key, params) => Object.entries(params ?? {}).reduce((value, [name, replacement]) =>
  value.replace(`{${name}}`, String(replacement)), messages[key] ?? key);

it('applies access changes only when published and copies or opens the full link for the chosen address', async () => {
  const urls = ['http://192.0.2.10:45670/#first-snapshot', 'http://[::1]:45670/#first-snapshot'];
  const initial: DesignPublishedPreview = { id: 'initial', designKey: 'workspace:design', documentId: 'draft', revision: '1', urls, access: 'link' };
  const updatedUrl = 'http://192.0.2.10:45671/#updated-snapshot';
  let live = initial;
  const bridge = { previewStatus: vi.fn(async () => live), stopPreview: vi.fn().mockResolvedValue(undefined) };
  const publish = vi.fn(async (access: DesignPreviewAccess) => {
    live = { ...initial, id: 'updated', revision: '2', urls: [updatedUrl], access: access.kind };
    return live;
  });
  const copyText = vi.fn().mockResolvedValue(undefined);
  const openExternal = vi.fn().mockResolvedValue(true);
  render(<UiProvider locale="en-US"><ToastProvider>
    <DesignUiHostContext.Provider value={{ copyText, openExternal, ShortcutSettings: () => null, ScrollOverlay: () => null, ProjectIcon: () => null }}>
      <DesignShareDialog bridge={bridge} designKey={initial.designKey} documentId={initial.documentId} disabled={false}
        publishing={false} packaging={false} publish={publish} copy={copyText} exportPackage={vi.fn()} onClose={vi.fn()} translate={translate} />
    </DesignUiHostContext.Provider>
  </ToastProvider></UiProvider>);

  const user = userEvent.setup();
  const share = within(await screen.findByRole('dialog', { name: 'Share' }));
  const copyPrimary = async () => user.click(await share.findByRole('button', { name: 'Copy link', exact: true }));
  const editAccess = () => user.click(share.getByRole('button', { name: /^Access\b/u }));
  const choosePassword = () => user.click(share.getByRole('radio', { name: 'Password protected' }));

  await copyPrimary();
  expect(copyText).toHaveBeenLastCalledWith(urls[0]);
  await user.click(share.getByRole('button', { name: 'Copy link for [::1]:45670' }));
  expect(copyText).toHaveBeenLastCalledWith(urls[1]);
  await user.click(share.getByRole('button', { name: 'Open [::1]:45670 in browser' }));
  expect(openExternal).toHaveBeenCalledWith(urls[1]);

  await editAccess();
  await choosePassword();
  await user.type(share.getByLabelText('Access password'), 'discarded password');
  await user.click(share.getByRole('button', { name: 'Cancel' }));
  expect(publish).not.toHaveBeenCalled();
  expect(bridge.stopPreview).not.toHaveBeenCalled();
  await copyPrimary();
  expect(copyText).toHaveBeenLastCalledWith(urls[0]);

  await editAccess();
  await choosePassword();
  const password = share.getByLabelText<HTMLInputElement>('Access password');
  expect(password.value).toBe('');
  await user.type(password, 'review password');
  await user.click(share.getByRole('button', { name: 'Publish new version' }));
  expect(publish).toHaveBeenCalledExactlyOnceWith({ kind: 'password', password: 'review password' });
  await copyPrimary();
  expect(copyText).toHaveBeenLastCalledWith(updatedUrl);

  await user.click(share.getByRole('button', { name: 'Publish new version' }));
  expect(publish).toHaveBeenCalledTimes(1);
  expect(share.getByLabelText<HTMLInputElement>('Access password').value).toBe('');
});

it('stops an active preview after moving to another draft without offering the old links there', async () => {
  let active: DesignPublishedPreview | null = { id: 'previous', designKey: 'workspace:original', documentId: 'original',
    revision: '1', urls: ['http://192.0.2.10:45670/#previous'], access: 'link' };
  const bridge = { previewStatus: vi.fn(async () => active), stopPreview: vi.fn(async () => { active = null; }) };
  const publish = vi.fn();
  render(<UiProvider locale="en-US"><ToastProvider>
    <DesignShareDialog bridge={bridge} designKey="workspace:current" documentId="current" disabled={false}
      publishing={false} packaging={false} publish={publish} copy={vi.fn()} exportPackage={vi.fn()} onClose={vi.fn()} translate={translate} />
  </ToastProvider></UiProvider>);

  const dialog = within(await screen.findByRole('dialog', { name: 'Share' }));
  const stop = await dialog.findByRole('button', { name: 'Stop sharing' });
  expect(dialog.queryByRole('button', { name: 'Copy link', exact: true })).toBeNull();
  await userEvent.setup().click(stop);
  expect(bridge.stopPreview).toHaveBeenCalledExactlyOnceWith('previous');
  expect(publish).not.toHaveBeenCalled();
});
