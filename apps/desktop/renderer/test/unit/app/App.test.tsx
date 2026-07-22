import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/app/App.js';

const useDesktopAppController = vi.hoisted(() => vi.fn());

vi.mock('../../../src/app/controller/useDesktopAppController.js', () => ({
  useDesktopAppController,
}));

describe('App', () => {
  afterEach(() => {
    useDesktopAppController.mockReset();
    vi.unstubAllGlobals();
  });

  it('renders an empty neutral surface when the desktop bridge is unavailable', () => {
    vi.stubGlobal('window', {});

    const html = renderToStaticMarkup(<App />);

    expect(html).toBe('<div class="app-blank-surface" aria-hidden="true"></div>');
    expect(html).not.toContain('Renderer error');
    expect(html).not.toContain('Desktop runtime bridge is unavailable');
  });

  it('keeps the runtime loading state free of shell chrome', () => {
    vi.stubGlobal('window', { setsunaDesktop: { runtime: {} } });
    useDesktopAppController.mockReturnValue({ loadState: 'loading' });

    const html = renderToStaticMarkup(<App />);

    expect(html).toBe('<div class="app-blank-surface" aria-hidden="true"></div>');
    expect(html).not.toContain('app-shell');
    expect(html).not.toContain('Starting runtime');
  });
});
