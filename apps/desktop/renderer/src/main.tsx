import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import 'antd/dist/reset.css';
import 'katex/dist/katex.min.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { CollaborationFeatureServiceBoundary } from './composition/CollaborationFeatureBoundary.js';
import { UpdaterFeatureServiceBoundary } from './composition/UpdaterFeatureBoundary.js';
import { activateBuiltinRendererFeatures } from './composition/renderer-feature-composition.js';
import { RendererFeatureViewsProvider } from './composition/feature-view-registries.js';
import { CodeAppearanceProvider } from './shared/code/CodeAppearanceProvider.js';
import { applyDesktopPlatformAttribute } from './shared/lib/desktopPlatform.js';
import { I18nProvider, initializeLocalePreference } from './shared/i18n/I18nProvider.js';
import { initializeAccentColorPreference } from './shared/preferences/useAccentColorPreference.js';
import { initializeAppearancePreference } from './shared/preferences/useAppearancePreferences.js';
import { initializeCodeAppearancePreference } from './shared/preferences/useCodeAppearancePreferences.js';
import { initializeSidebarBackgroundPreference } from './shared/preferences/useSidebarBackgroundPreference.js';
import { initializeThemePreference } from './shared/preferences/useThemeTransition.js';
import { KeyboardShortcutsProvider } from './shared/shortcuts/KeyboardShortcutsProvider.js';

// Shared defaults must load before feature styles so scoped components can override them.
import './shared/styles/tokens.css';
import './app/styles/app.css';
import './features/settings/styles/settings-data-root.css';
import './shared/styles/file-icons.css';
import './shared/styles/brand-icons.css';
import './shared/styles/plugin-icons.css';
import './shared/styles/primitives.css';
import './app/styles/sidebar.css';
import './app/styles/project-editor.css';
import './features/workspace/styles/panel-chrome.css';
import './features/workspace/styles/workspace.css';
import './features/workspace/styles/bottom-panel.css';
import './features/chat/styles/chat.css';
import './features/chat/styles/chat-timeline-divider.css';
import './shared/styles/loading-indicators.css';
import './features/chat/styles/markdown.css';
import './features/chat/styles/chat-composer.css';
import './features/chat/styles/chat-send-queue.css';
import './features/runtime-activity/styles/runtime-activity.css';
import './app/styles/sidebar-search.css';
import './shared/styles/code-theme.css';

applyDesktopPlatformAttribute();
initializeLocalePreference();
initializeThemePreference();
initializeAccentColorPreference();
initializeAppearancePreference();
initializeCodeAppearancePreference();
initializeSidebarBackgroundPreference();

async function bootstrapRenderer(): Promise<void> {
  const features = await activateBuiltinRendererFeatures();
  window.addEventListener('beforeunload', () => {
    void features.composition.dispose();
  }, { once: true });

  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider messageCatalog={features.messages}>
        <RendererFeatureViewsProvider views={features.views}>
          <UpdaterFeatureServiceBoundary service={features.updater}>
            <CollaborationFeatureServiceBoundary service={features.collaboration}>
              <KeyboardShortcutsProvider>
                <CodeAppearanceProvider>
                  <App />
                </CodeAppearanceProvider>
              </KeyboardShortcutsProvider>
            </CollaborationFeatureServiceBoundary>
          </UpdaterFeatureServiceBoundary>
        </RendererFeatureViewsProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrapRenderer().catch((error: unknown) => {
  console.error('[RendererFeatureComposition]', error);
});
