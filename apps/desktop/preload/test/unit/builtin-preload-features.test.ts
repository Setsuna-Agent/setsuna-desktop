import type { SetsunaDesktopBridge } from '@setsuna-desktop/contracts';
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import { composeBuiltinPreloadBridge } from '../../src/composition/builtin-preload-features.js';

it('composes supported feature bridges without exposing retired sync capabilities', () => {
  const hostBridge = {
    dataRoot: {}, desktop: {}, links: {}, runtime: {}, windowControls: {},
  } as SetsunaDesktopBridge;

  const bridge = composeBuiltinPreloadBridge(hostBridge);

  expect(bridge.runtime).toBe(hostBridge.runtime);
  expect(bridge.updater).toBeDefined();
  expect(bridge.networkProxy).toBeDefined();
  expect(bridge).not.toHaveProperty('webdavSync');
});
