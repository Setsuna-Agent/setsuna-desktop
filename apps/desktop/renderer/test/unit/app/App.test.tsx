// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/app/App.js';

const useDesktopAppController = vi.hoisted(() => vi.fn());

vi.mock('../../../src/app/controller/useDesktopAppController.js', () => ({
  useDesktopAppController,
}));

describe('App', () => {
  afterEach(() => {
    cleanup();
    useDesktopAppController.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders an empty neutral surface when the desktop bridge is unavailable', () => {
    setDesktopBridge(undefined);

    const { container } = render(<App />);

    expect(container.querySelector('.app-blank-surface')).toBeTruthy();
    expect(container.querySelector('.app-shell')).toBeNull();
  });

  it('keeps the runtime loading state free of shell chrome', () => {
    setDesktopBridge(createDesktopBridge());
    useDesktopAppController.mockReturnValue({ loadState: 'loading' });

    const { container } = render(<App />);

    expect(container.querySelector('.app-blank-surface')).toBeTruthy();
    expect(container.querySelector('.app-shell')).toBeNull();
  });

  it('offers a renderer reload after a descendant render failure', async () => {
    setDesktopBridge(createDesktopBridge());
    useDesktopAppController.mockImplementation(() => {
      throw new Error('render exploded');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);

    render(<App />);

    expect(screen.getByText('render exploded')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /重试|retry/iu }));
    expect(reload).toHaveBeenCalledOnce();
  });
});

function setDesktopBridge(value: unknown): void {
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value,
  });
}

function createDesktopBridge(): unknown {
  return {
    desktop: {
      setInterfaceLanguage: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {},
  };
}
