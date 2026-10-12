import { describe, expect, it } from 'vitest';
import { parseRuntimePluginUiManifest } from '../src/plugin-ui.js';

const page = {
  id: 'notes.page', slot: 'renderer.plugin.page', navigation: { label: 'Notes' },
  data: { stateKey: 'notes', scope: 'global' },
  reactApp: { root: 'apps/notes', entry: 'pages/Home.tsx', routes: [{ path: '/note/:id', entry: 'pages/Note.tsx' }], actionIds: ['notes.save'] },
};
const parse = (contribution: unknown) => parseRuntimePluginUiManifest({ schemaVersion: 2, actions: [{ id: 'notes.save' }], contributions: [contribution] });

describe('Plugin React application contract', () => {
  it('registers an independent project, parameterized routes and existing state/actions', () => {
    expect(parse(page).contributions[0]).toEqual(page);
    expect(parse({ ...page, reactApp: { ...page.reactApp, root: 'apps\\notes', entry: 'pages\\Home.tsx' } }).contributions[0].reactApp)
      .toMatchObject({ root: 'apps/notes', entry: 'pages/Home.tsx' });
  });

  it('rejects project escapes, reserved directories, ambiguous modes and undeclared actions', () => {
    for (const root of ['../app', '/app', 'C:\\app', 'app//src', 'app/Node_Modules', 'app/.Setsuna']) {
      expect(() => parse({ ...page, reactApp: { ...page.reactApp, root } })).toThrow();
    }
    for (const patch of [{ entry: '../Home.tsx' }, { entry: 'Home.html' }, { actionIds: ['host.delete'] },
      { routes: [{ path: '/note?secret', entry: 'Note.tsx' }] }, { routes: [{ path: '/*', entry: 'Note.tsx' }] },
      { routes: [{ path: '/note', entry: 'a.tsx' }, { path: '/note', entry: 'b.tsx' }] },
      { configFile: 'vite.config.ts' }]) {
      expect(() => parse({ ...page, reactApp: { ...page.reactApp, ...patch } })).toThrow();
    }
    expect(() => parse({ ...page, document: { htmlResourceId: 'html', actionIds: [] } })).toThrow('exactly one');
    expect(() => parse({ ...page, slot: 'renderer.chat.composer.status', navigation: undefined })).toThrow('standalone');
  });
});
