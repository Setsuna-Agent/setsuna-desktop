// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SandboxDialogSession } from '@setsuna-desktop/contracts';
import { useSandboxDialogSession } from '../../../../src/kernel/sandboxed-plugin-ui/useSandboxDialogSession.js';
import { SandboxedUiFrame } from '../../../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js';

const original = Object.getOwnPropertyDescriptor(window, 'setsunaDesktop');
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(window, 'setsunaDesktop', original);
  else delete window.setsunaDesktop;
});

it('keeps the document and unsaved inputs intact across renames while updating dialog titles', async () => {
  const session = { id: 'a'.repeat(64), url: `http://127.0.0.1:1234/v1/sandbox-dialogs/${'a'.repeat(64)}` };
  const createSandboxDialogSession = vi.fn(async () => session);
  const updateSandboxDialogSession = vi.fn(async () => undefined);
  const releaseSandboxDialogSession = vi.fn(async () => undefined);
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    desktop: { createSandboxDialogSession, updateSandboxDialogSession, releaseSandboxDialogSession },
  } });
  const source = { html: '<main>Table</main>', css: '', js: '' };
  const view = render(createElement(SandboxedUiFrame, { title: 'Table', source }));
  const frame = await screen.findByTitle('Table') as HTMLIFrameElement;
  const srcdoc = frame.srcdoc;
  const draft = frame.contentDocument!.createElement('input');
  frame.contentDocument!.body.append(draft);
  draft.value = 'Unsaved row';
  for (const title of ['Renamed table', 'Table']) {
    view.rerender(createElement(SandboxedUiFrame, { title, source }));
    expect(screen.getByTitle(title)).toBe(frame);
    expect(frame.srcdoc).toBe(srcdoc);
    expect(frame.contentDocument!.querySelector('input')?.value).toBe('Unsaved row');
    await waitFor(() => expect(updateSandboxDialogSession).toHaveBeenLastCalledWith(session.id, title));
  }
  expect(createSandboxDialogSession).toHaveBeenCalledTimes(1);
  expect(releaseSandboxDialogSession).not.toHaveBeenCalled();
  view.unmount();
  expect(releaseSandboxDialogSession).toHaveBeenCalledExactlyOnceWith(session.id);
});

it('uses the latest title if renamed while session creation is pending', async () => {
  let finish!: (session: SandboxDialogSession) => void;
  const createSandboxDialogSession = vi.fn(() => new Promise<SandboxDialogSession>((resolve) => { finish = resolve; }));
  const updateSandboxDialogSession = vi.fn(async () => undefined);
  const releaseSandboxDialogSession = vi.fn(async () => undefined);
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    desktop: { createSandboxDialogSession, updateSandboxDialogSession, releaseSandboxDialogSession },
  } });
  const view = renderHook(({ title }) => useSandboxDialogSession(title), { initialProps: { title: 'Table' } });
  view.rerender({ title: 'New table' });
  await act(async () => finish({ id: 'session', url: 'url' }));
  expect(view.result.current).toMatchObject({ ready: true, url: 'url' });
  expect(createSandboxDialogSession).toHaveBeenCalledTimes(1);
  expect(updateSandboxDialogSession).toHaveBeenLastCalledWith('session', 'New table');
  expect(releaseSandboxDialogSession).not.toHaveBeenCalled();
});

it('waits for a dialog capability and revokes it when its frame is removed', async () => {
  const session = { id: 'one', url: 'http://127.0.0.1:1234/session' };
  let finish!: (session: SandboxDialogSession) => void;
  const createSandboxDialogSession = vi.fn(() => new Promise<SandboxDialogSession>((resolve) => { finish = resolve; }));
  const releaseSandboxDialogSession = vi.fn(async () => undefined);
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { createSandboxDialogSession, releaseSandboxDialogSession } } });
  const first = renderHook(() => useSandboxDialogSession('Table'));
  expect(first.result.current.ready).toBe(false);
  await act(async () => finish(session));
  expect(first.result.current).toMatchObject({ ready: true, url: session.url });
  first.unmount();
  expect(releaseSandboxDialogSession).toHaveBeenCalledWith('one');
  const second = renderHook(() => useSandboxDialogSession('Another table'));
  second.unmount();
  await act(async () => finish({ ...session, id: 'late' }));
  await waitFor(() => expect(releaseSandboxDialogSession).toHaveBeenCalledWith('late'));
});
