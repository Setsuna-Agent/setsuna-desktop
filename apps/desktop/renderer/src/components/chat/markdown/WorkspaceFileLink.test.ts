import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWorkspaceFileReference } from './WorkspaceFileLink.js';

describe('workspace file link opening', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the configured workspace app before the operating-system default', () => {
    const openWithSystemDefault = vi.fn();
    const openWithSelectedApp = vi.fn();
    vi.stubGlobal('window', {
      setsunaDesktop: {
        desktop: { openWorkspaceFile: openWithSystemDefault },
      },
    });

    openWorkspaceFileReference('/workspace', 'src/main.ts', 12, openWithSelectedApp);

    expect(openWithSelectedApp).toHaveBeenCalledWith('src/main.ts', 12);
    expect(openWithSystemDefault).not.toHaveBeenCalled();
  });
});
