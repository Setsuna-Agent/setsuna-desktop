import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DesktopPanelHeader,
  panelDragPreviewPosition,
  panelLauncherMenuPosition,
} from '../../../../src/features/workspace/DesktopPanelHeader.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

describe('DesktopPanelHeader browser tabs', () => {
  it('renders a browser page through the same ordinary tab path', () => {
    const html = renderToStaticMarkup(createElement(DesktopPanelHeader, {
      activePanel: 'browser',
      activePanelId: 'browser-1',
      onClose: vi.fn(),
      onClosePanel: vi.fn(),
      onSelectPanel: vi.fn(),
      panels: [
        { id: 'review', type: 'review' },
        {
          browser: { faviconUrl: 'https://example.com/favicon.ico', loading: false, url: 'https://example.com/' },
          id: 'browser-1',
          title: 'Example',
          type: 'browser',
        },
      ],
      placement: 'side',
    }));

    expect(html).not.toContain('desktop-browser-tabs-host');
    expect(html).toContain('data-desktop-panel-tab-id="browser-1"');
    expect(html).toContain('title="Example"');
    expect(html).toContain('src="https://example.com/favicon.ico"');
    expect(html).toContain('aria-label="关闭Example"');
    expect(html).toContain('title="审查"');
  });

  it('keeps the shared panel launcher when a browser panel already exists', () => {
    const html = renderToStaticMarkup(createElement(DesktopPanelHeader, {
      activePanel: 'browser',
      activePanelId: 'browser-1',
      availablePanelTypes: ['browser'],
      onClose: vi.fn(),
      onClosePanel: vi.fn(),
      onOpenPanel: vi.fn(),
      onSelectPanel: vi.fn(),
      panels: [{ id: 'browser-1', type: 'browser', title: '新标签页' }],
      placement: 'side',
    }));

    expect(html).toContain('aria-label="添加面板"');
  });

  it('renders panel tabs and the launcher in English', () => {
    const html = renderToStaticMarkup(createElement(
      I18nProvider,
      { initialLocale: 'en-US' },
      createElement(DesktopPanelHeader, {
        activePanel: 'files',
        activePanelId: 'files',
        availablePanelTypes: ['browser'],
        onClose: vi.fn(),
        onClosePanel: vi.fn(),
        onOpenPanel: vi.fn(),
        onSelectPanel: vi.fn(),
        panels: [
          { id: 'side-chat-1', title: '侧边任务', type: 'chat' },
          { id: 'side-chat-2', title: '侧边任务 2', type: 'chat' },
          { id: 'review', type: 'review' },
          { id: 'files', type: 'files' },
        ],
        placement: 'side',
      }),
    ));

    expect(html).toContain('title="Side chat"');
    expect(html).toContain('title="Side chat 2"');
    expect(html).toContain('title="Review"');
    expect(html).toContain('title="Open File"');
    expect(html).toContain('aria-label="Add panel"');
    expect(html).not.toContain('title="审查"');
    expect(html).not.toContain('title="侧边任务');
  });
});

describe('DesktopPanelHeader launcher menu positioning', () => {
  it('opens the menu to the right from the launcher', () => {
    expect(panelLauncherMenuPosition({ bottom: 42, left: 248 }, 744)).toEqual({ left: 248, top: 48 });
  });

  it('keeps the menu inside the viewport', () => {
    expect(panelLauncherMenuPosition({ bottom: 42, left: 4 }, 744)).toEqual({ left: 8, top: 48 });
    expect(panelLauncherMenuPosition({ bottom: 42, left: 700 }, 744)).toEqual({ left: 580, top: 48 });
  });

  it('converts visual coordinates back to zoomed body coordinates', () => {
    expect(panelLauncherMenuPosition({ bottom: 84, left: 496 }, 1488, 0.5)).toEqual({ left: 248, top: 48 });
  });
});

describe('DesktopPanelHeader tab drag preview positioning', () => {
  it('keeps the preview under the pointer when the page is zoomed', () => {
    expect(
      panelDragPreviewPosition(
        { clientX: 500, clientY: 120 },
        {
          height: 28,
          offsetX: 32,
          offsetY: 10,
          scaleInverse: 0.5,
          width: 104,
        },
      ),
    ).toEqual({ height: 28, left: 218, top: 50, width: 104 });
  });
});
