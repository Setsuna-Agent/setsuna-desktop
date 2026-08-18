// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import {
  openWorkspaceFileReference,
  WorkspaceFileLink,
} from '../../../../../src/features/chat/markdown/WorkspaceFileLink.js';

describe('workspace file link opening', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it('opens the shared workspace file menu with the resolved file and line', () => {
    const onOpenWorkspaceFileContextMenu = vi.fn();
    render(createElement(
      MarkdownNavigationProvider,
      {
        children: createElement(WorkspaceFileLink, {
          filePath: '/workspace/src/main.ts#L18',
          linkKind: 'workspace',
        }, 'main.ts'),
        onOpenWorkspaceFileContextMenu,
        workspaceRoot: '/workspace',
      },
    ));

    const defaultAllowed = fireEvent.contextMenu(screen.getByRole('link', { name: /main\.ts/u }), {
      clientX: 120,
      clientY: 240,
    });

    expect(defaultAllowed).toBe(false);
    expect(onOpenWorkspaceFileContextMenu).toHaveBeenCalledWith({
      filePath: 'src/main.ts',
      line: 18,
      x: 120,
      y: 240,
    });
  });
});
