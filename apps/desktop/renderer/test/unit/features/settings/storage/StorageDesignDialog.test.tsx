// @vitest-environment happy-dom
import type { LocalDesignFile } from '@setsuna-desktop/feature-design/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import type { DesignClient } from '../../../../../src/composition/design/DesignFeatureBoundary.js';
import { StorageDesignDialog } from '../../../../../src/features/settings/storage/StorageDesignDialog.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

it('deletes a selected chain of libraries in one confirmation and preserves libraries still in use', async () => {
  const document = (name: string, ...libraries: string[]): Extract<LocalDesignFile, { kind: 'document' }> => ({
    kind: 'document', path: name + '.design.json', revision: 'saved', bytes: 10, libraryPaths: libraries.map((id) => id + '.design.json'),
  });
  const drafts = [document('A'), document('B', 'A'), document('C', 'A'), document('D', 'E'), document('E', 'D'),
    document('Shared'), document('Unselected', 'Shared'), document('Z', 'B', 'C')];
  const files = new Map(drafts.map((file) => [file.path, file]));
  const client: Pick<DesignClient, 'fonts' | 'listLocalFiles' | 'resolveResourceRoot' | 'delete'> = {
    fonts: { list: async () => [], import: vi.fn(), read: vi.fn(), remove: vi.fn() },
    listLocalFiles: async () => ({ files: [...files.values()], incomplete: false }),
    resolveResourceRoot: async (ref) => ref,
    delete: async (ref) => {
      if ([...files.values()].some((file) => file.libraryPaths?.includes(ref.path))) throw new Error('Library in use');
      files.delete(ref.path);
      return null;
    },
  };
  const changed = vi.fn();
  render(<I18nProvider initialLocale="en-US"><ToastProvider>
    <StorageDesignDialog client={client as DesignClient} onChange={changed} onClose={() => undefined} />
  </ToastProvider></I18nProvider>);
  fireEvent.click(await screen.findByRole('checkbox', { name: /Local designs/u }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Unselected\.design/u }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  const confirmation = within(await screen.findByRole('dialog', { name: 'Clear disk space?' }));
  fireEvent.click(confirmation.getByRole('button', { name: 'Delete selected' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect([...files.keys()]).toEqual(['D.design.json', 'E.design.json', 'Shared.design.json', 'Unselected.design.json']);
});

it('requires confirmation and retries only the failed selection after a draft releases another asset', async () => {
  const draft: LocalDesignFile = { kind: 'document', path: 'board.design.json', revision: 'saved', bytes: 24 };
  const asset: LocalDesignFile = { kind: 'asset', path: 'old.png', revision: 'first', bytes: 8 };
  const released = { ...asset, path: 'released.png', revision: 'other' };
  let files = [draft, asset];
  const removeDraft = vi.fn(async () => { files = [asset, released]; return null; });
  const removeAssets = vi.fn<DesignClient['removeUnusedAssets']>()
    .mockResolvedValueOnce([asset.path]).mockImplementationOnce(async () => { files = [released]; return []; });
  const client: Pick<DesignClient, 'fonts' | 'listLocalFiles' | 'resolveResourceRoot' | 'delete' | 'removeUnusedAssets'> = {
    fonts: { list: async () => [], import: vi.fn(), read: vi.fn(), remove: vi.fn() }, listLocalFiles: async () => ({ files, incomplete: false }),
    resolveResourceRoot: async (ref) => ref, delete: removeDraft, removeUnusedAssets: removeAssets,
  };
  const changed = vi.fn();
  render(<I18nProvider initialLocale="en-US"><ToastProvider>
    <StorageDesignDialog client={client as DesignClient} onChange={changed} onClose={() => undefined} />
  </ToastProvider></I18nProvider>);
  fireEvent.click(await screen.findByRole('checkbox', { name: /board\.design\.json/u }));
  fireEvent.click(screen.getByRole('checkbox', { name: /old\.png/u }));

  const confirm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    return within(await screen.findByRole('dialog', { name: 'Clear disk space?' }));
  };
  fireEvent.click((await confirm()).getByRole('button', { name: 'Cancel' }));
  expect(removeDraft).not.toHaveBeenCalled();
  expect(removeAssets).not.toHaveBeenCalled();

  fireEvent.click((await confirm()).getByRole('button', { name: 'Delete selected' }));
  const next = await screen.findByRole('checkbox', { name: /released\.png/u });
  expect((next as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: /old\.png/u }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click((await confirm()).getByRole('button', { name: 'Delete selected' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  expect(removeDraft).toHaveBeenCalledExactlyOnceWith({ storageId: 'local', path: draft.path, expectedRevision: 'saved' }, expect.anything());
  expect(removeAssets.mock.calls.map(([items]) => items.map((item) => item.path))).toEqual([[asset.path], [asset.path]]);
});
