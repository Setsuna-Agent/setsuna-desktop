// @vitest-environment happy-dom
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { designDocumentVersion } from '@setsuna-desktop/feature-design/contracts';
import { DesignDocumentSurface, designRendererFeature, type DesignClient } from '@setsuna-desktop/feature-design/renderer';
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { DesignFeatureServiceBoundary } from '../../../../src/composition/design/DesignClientContext.js';
import { I18nProvider, useI18n } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

vi.mock('../../../../../../../packages/features/design/src/renderer/DesignCanvas.js', async () => {
  const { forwardRef } = await import('react');
  // Keep the editor toolbar available without a native canvas context in happy-dom.
  return { DesignCanvas: forwardRef<unknown, { toolbarActions: ReactNode }>(function SettingsCanvas({ toolbarActions }, _ref) {
    return <>{toolbarActions}</>;
  }) };
});

const messages = composeRendererMessages(hostMessages, [{ module: designRendererFeature }]);
const preferencesKey = 'setsuna.design.canvas-settings';
afterEach(() => { cleanup(); localStorage.clear(); });

function renderCanvas(onNewChat?: () => void) {
  const documentRef = { storageId: 'local', path: 'settings.design.json' };
  const read: DesignClient['read'] = async () => ({
    document: { schemaVersion: designDocumentVersion, documentId: 'settings', rootIds: [], nodes: {} },
    revision: '0', canUndo: false, canRedo: false,
  });
  const client = { read, fonts: { list: async () => [] }, assets: { output: {} } } as unknown as DesignClient;
  function Canvas() {
    const { t } = useI18n();
    useAppKeyboardShortcuts(onNewChat ? { 'app.newChat': { execute: onNewChat } } : {});
    return <DesignFeatureServiceBoundary client={client}>
      <DesignDocumentSurface client={client} documentRef={documentRef} translate={t} />
    </DesignFeatureServiceBoundary>;
  }

  return render(<I18nProvider initialLocale="en-US" messageCatalog={messages}><KeyboardShortcutsProvider initialPlatform="win32">
    <ToastProvider><Canvas /></ToastProvider>
  </KeyboardShortcutsProvider></I18nProvider>);
}

it('reassigns a design key from the modal while leaving the app shortcut available', async () => {
  localStorage.setItem(preferencesKey, JSON.stringify({ snapToObjects: false }));
  const onNewChat = vi.fn();
  const user = userEvent.setup();
  renderCanvas(onNewChat);
  const trigger = await screen.findByRole('button', { name: 'Design settings' });
  const openShortcuts = async () => {
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Design settings' });
    await user.click(within(dialog).getByRole('tab', { name: 'Shortcuts' }));
    return within(dialog);
  };

  const editor = await openShortcuts();
  await user.click(await editor.findByRole('button', { name: 'Edit shortcut R' }));
  const appBinding = { key: 'n', code: 'KeyN', ctrlKey: true };
  fireEvent.keyDown(window, appBinding);
  expect(onNewChat).toHaveBeenCalledTimes(0);
  expect(editor.getByText('This shortcut is assigned to “New chat”.')).toBeTruthy();
  await user.keyboard('v');
  const confirm = await screen.findByRole('dialog', { name: 'Replace shortcut binding' });
  await user.click(within(confirm).getByRole('button', { name: 'Replace shortcut binding' }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(preferencesKey)!)).toMatchObject({
    snapToObjects: false, shortcuts: { 'tool.select': [], 'tool.rectangle': ['KeyV'] },
  }));

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.keyDown(trigger, appBinding);
  expect(onNewChat).toHaveBeenCalledOnce();
  const reopened = await openShortcuts();
  const rectangle = (await reopened.findByText('Rectangle')).closest('article')!;
  expect(within(rectangle).getByRole('button', { name: 'Edit shortcut V' })).toBeTruthy();
});

it('restores the spacing saved for each grid pattern after reopening the canvas', async () => {
  const user = userEvent.setup();
  const openSettings = async () => {
    await user.click(await screen.findByRole('button', { name: 'Design settings' }));
    return within(await screen.findByRole('dialog', { name: 'Design settings' }));
  };
  const spacing = (settings: Awaited<ReturnType<typeof openSettings>>) =>
    settings.getByRole<HTMLInputElement>('slider', { name: 'Grid spacing' });

  localStorage.setItem(preferencesKey, JSON.stringify({ grid: 'dots' }));
  const canvas = renderCanvas();
  const settings = await openSettings();
  fireEvent.change(spacing(settings), { target: { value: '20' } });
  await user.click(settings.getByRole('button', { name: 'Lines' }));
  expect(spacing(settings).value).toBe('32');
  fireEvent.change(spacing(settings), { target: { value: '48' } });
  canvas.unmount();

  renderCanvas();
  const reopened = await openSettings();
  expect(spacing(reopened).value).toBe('48');
  await user.click(reopened.getByRole('button', { name: 'Dots' }));
  expect(spacing(reopened).value).toBe('20');
});
