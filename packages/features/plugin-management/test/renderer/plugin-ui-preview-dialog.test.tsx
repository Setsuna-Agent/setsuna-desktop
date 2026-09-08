import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PluginUiPreviewDialog } from '../../src/renderer/PluginUiPreviewDialog.js';
import type { PluginManagementTranslate } from '../../src/renderer/messages.js';

const translate: PluginManagementTranslate = (key) => key;
const ui = {
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Dialog: ({ children, title }: { children?: ReactNode; title: ReactNode }) => (
    <section><h1>{title}</h1>{children}</section>
  ),
  EmptyState: ({ body, title }: { body?: string; title: string }) => <p>{title}: {body}</p>,
  SandboxedUiFrame: ({ data, source, title }: {
    data?: Readonly<Record<string, unknown>>;
    source: Readonly<{ html: string }>;
    title: string;
  }) => <div data-html={source.html} data-temperature={String(data?.temperature)}>{title}</div>,
} as unknown as SettingsViewUi;

describe('Plugin UI preview dialog', () => {
  it('renders declared sample source and data through the injected sandbox frame', () => {
    const html = renderToStaticMarkup(
      <PluginUiPreviewDialog
        surface={{
          id: 'card:weather.current',
          kind: 'chat-card',
          preview: {
            html: '<main id="weather"></main>',
            css: '',
            js: '',
            data: { temperature: 28 },
          },
          renderMode: 'sandbox',
          title: 'Current weather',
        }}
        translate={translate}
        ui={ui}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('data-html="&lt;main id=&quot;weather&quot;&gt;&lt;/main&gt;"');
    expect(html).toContain('data-temperature="28"');
    expect(html).toContain('feature.pluginManagement.interface.previewSample');
  });

  it('explains why a declared card without a static sample cannot be previewed', () => {
    const html = renderToStaticMarkup(
      <PluginUiPreviewDialog
        surface={{
          id: 'card:weather_today',
          kind: 'chat-card',
          renderMode: 'sandbox',
          title: 'weather_today',
        }}
        translate={translate}
        ui={ui}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('feature.pluginManagement.interface.previewUnavailableTitle');
    expect(html).toContain('feature.pluginManagement.interface.previewUnavailableBody');
  });
});
