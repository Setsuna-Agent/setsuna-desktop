// @vitest-environment happy-dom

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { designDocumentVersion, type DesignFrame } from '../../src/contracts/index.js';
import { mountEditor } from './support/mount-design-editor.js';

const rectangle = { kind: 'rectangle', x: 100, y: 150, width: 100, height: 32, cornerRadius: 0 } as const;
const artboard = { kind: 'frame', x: 0, y: 0, width: 360, height: 900, childIds: [] } as const;
const presentation = () => screen.findByRole('dialog', { name: 'feature.design.prototype.preview' });

it('restores the edit selection and drawing coordinates after fullscreen navigation', async () => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'presentation', rootIds: ['intro', 'detail', 'overlay'], nodes: {
    intro: { ...artboard, name: 'Intro', childIds: ['next', 'show'] },
    detail: { ...artboard, name: 'Detail', x: 800 },
    overlay: { ...artboard, name: 'Overlay', x: 1600, height: 200 },
    next: { ...rectangle, name: 'Open detail', interaction: { kind: 'navigate', targetId: 'detail' } },
    show: { ...rectangle, name: 'Open overlay', y: 220, interaction: { kind: 'overlay', targetId: 'overlay' } },
  } });
  const root = document.documentElement;
  let fullscreenElement: Element | null = null;
  function changeFullscreen(element: Element | null) {
    fullscreenElement = element;
    fireEvent(document, new Event('fullscreenchange'));
  }
  const requestFullscreen = vi.fn(async () => { changeFullscreen(root); });
  const exitFullscreen = vi.fn(async () => { changeFullscreen(null); });
  Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: requestFullscreen });
  Object.defineProperties(document, {
    fullscreenElement: { configurable: true, get: () => fullscreenElement },
    exitFullscreen: { configurable: true, value: exitFullscreen },
  });

  try {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Intro' }));
    const canvas = screen.getByRole<HTMLDivElement>('region', { name: 'feature.design.canvas' });
    canvas.setPointerCapture = () => undefined;
    await user.click(screen.getByRole('button', { name: 'feature.design.zoomIn' }));
    const pan = { pointerId: 1, button: 1, clientX: 30, clientY: 40 };
    fireEvent.pointerDown(canvas, pan);
    fireEvent.pointerMove(canvas, { ...pan, clientX: 70, clientY: 60 });
    fireEvent.pointerUp(canvas, { ...pan, clientX: 70, clientY: 60 });

    const launch = screen.getByRole('button', { name: 'feature.design.prototype.preview' });
    await user.click(launch);
    const dialog = within(await presentation());
    expect(requestFullscreen).toHaveBeenCalledOnce();

    async function choosePresentationOption(name: string) {
      await user.click(dialog.getByRole('button', { name: 'feature.design.prototype.currentBoard' }));
      (await screen.findByRole('menuitem', { name: 'feature.design.prototype.options' })).focus();
      await user.keyboard('{ArrowRight}');
      await user.click(await screen.findByRole('menuitem', { name }));
    }

    async function turnPage(name: string) {
      dialog.getByRole('button', { name }).focus();
      await user.keyboard('{Enter}');
    }

    const zoom = within(dialog.getByRole('group', { name: 'feature.design.prototype.scale' }));
    await user.click(zoom.getByRole('button', { name: /^feature\.design\.prototype\.scale / }));
    await user.click(await screen.findByRole('menuitem', { name: '100%' }));
    await user.click(zoom.getByRole('button', { name: 'feature.design.zoomIn' }));
    zoom.getByRole('button', { name: 'feature.design.prototype.scale 125%' });
    await user.click(zoom.getByRole('button', { name: 'feature.design.zoomOut' }));
    await user.click(zoom.getByRole('button', { name: 'feature.design.prototype.scale 100%' }));
    await user.click(await screen.findByRole('menuitem', { name: 'feature.design.prototype.scale.width' }));
    const intro = () => dialog.getByRole('region', { name: 'Intro' });
    intro().scrollTop = 240;
    await user.click(await dialog.findByRole('button', { name: 'Open overlay' }));
    await dialog.findByRole('region', { name: 'Overlay' });
    await user.keyboard('{Escape}');
    expect(intro().scrollTop).toBe(240);
    await user.click(await dialog.findByRole('button', { name: 'Open detail' }));
    expect((await dialog.findByRole('region', { name: 'Detail' })).scrollTop).toBe(0);
    await choosePresentationOption('feature.design.prototype.back');
    expect(intro().scrollTop).toBe(240);
    await choosePresentationOption('feature.design.prototype.restart');
    expect(intro().scrollTop).toBe(0);

    const previousBoard = 'feature.design.prototype.previousBoard';
    const nextBoard = 'feature.design.prototype.nextBoard';
    expect(dialog.queryByRole('button', { name: previousBoard })).toBeNull();
    await turnPage(nextBoard);
    await dialog.findByRole('img', { name: 'Detail' });
    await turnPage(nextBoard);
    await dialog.findByRole('img', { name: 'Overlay' });
    expect(dialog.queryByRole('button', { name: nextBoard })).toBeNull();
    await turnPage(previousBoard);
    await dialog.findByRole('img', { name: 'Detail' });

    await user.keyboard('{Delete}');
    expect(commit).not.toHaveBeenCalled();

    changeFullscreen(null);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launch));
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'feature.design.name' }).value).toBe('Intro');
    screen.getByRole('button', { name: 'feature.design.zoom 125%' });

    await user.click(launch);
    await user.click(within(await presentation()).getByRole('button', { name: 'feature.design.prototype.exit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(exitFullscreen).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'feature.design.tool.rectangle' }));
    const draw = { pointerId: 1, button: 0, clientX: 150, clientY: 130 };
    fireEvent.pointerDown(canvas, draw);
    fireEvent.pointerMove(canvas, { ...draw, clientX: 175, clientY: 155 });
    fireEvent.pointerUp(canvas, { ...draw, clientX: 175, clientY: 155 });
    await waitFor(async () => {
      const { document: saved } = await read();
      const ids = (saved.nodes.intro as DesignFrame).childIds;
      expect(saved.nodes[ids.at(-1)!]).toMatchObject({ kind: 'rectangle', x: 20, y: 20 });
    });
  } finally {
    Reflect.deleteProperty(root, 'requestFullscreen');
    Reflect.deleteProperty(document, 'exitFullscreen');
    Reflect.deleteProperty(document, 'fullscreenElement');
  }
});

it('uses a saved start and commits a navigation link only after choosing the target', async () => {
  const { commit, read } = await mountEditor({ schemaVersion: designDocumentVersion, documentId: 'prototype-links', rootIds: ['intro', 'detail'], nodes: {
    intro: { ...artboard, name: 'Intro', childIds: ['link'] },
    detail: { ...artboard, name: 'Detail', x: 800 },
    link: { ...rectangle, name: 'Continue' },
  } });
  const user = userEvent.setup();
  async function playFrom(label: string, artboard: string) {
    await user.click(screen.getByRole('button', { name: label }));
    const dialog = within(await presentation());
    await dialog.findByRole('img', { name: artboard });
    await user.click(dialog.getByRole('button', { name: 'feature.design.prototype.exit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }

  await user.click(await screen.findByRole('button', { name: 'Detail' }));
  await user.click(screen.getByRole('button', { name: 'feature.design.prototype.setStart' }));
  await waitFor(async () => expect((await read()).document.prototypeStartId).toBe('detail'));
  await user.click(screen.getByRole('button', { name: 'Intro' }));
  await playFrom('feature.design.prototype.previewBoard', 'Detail');
  await playFrom('feature.design.prototype.playFromBoard', 'Intro');

  await user.click(screen.getByRole('button', { name: 'feature.design.expandLayer' }));
  await user.click(await screen.findByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('combobox', { name: 'feature.design.prototype.action' }));
  await user.click(await screen.findByRole('option', { name: 'feature.design.prototype.navigate' }));
  expect(commit).toHaveBeenCalledOnce();
  expect((await read()).document.nodes.link.interaction).toBeUndefined();
  await user.click(screen.getByRole('combobox', { name: 'feature.design.prototype.target' }));
  await user.click(await screen.findByRole('option', { name: 'Detail' }));
  await waitFor(async () => expect((await read()).document.nodes.link.interaction).toEqual({ kind: 'navigate', targetId: 'detail' }));
});
