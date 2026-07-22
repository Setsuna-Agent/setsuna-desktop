import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import 'antd/dist/reset.css';
import 'katex/dist/katex.min.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './app/styles/app.css';
import './app/styles/sidebar-search.css';
import './app/styles/sidebar.css';
import './features/capabilities/styles/capabilities.css';
import './features/chat/styles/chat-composer.css';
import './features/chat/styles/chat-timeline-divider.css';
import './features/chat/styles/chat.css';
import './features/chat/styles/markdown.css';
import './features/settings/styles/settings.css';
import './features/workspace/styles/bottom-panel.css';
import './features/workspace/styles/panel-chrome.css';
import './features/workspace/styles/workspace.css';
import { applyDesktopPlatformAttribute } from './shared/lib/desktopPlatform.js';
import { I18nProvider, initializeLocalePreference } from './shared/i18n/I18nProvider.js';
import { initializeAccentColorPreference } from './shared/preferences/useAccentColorPreference.js';
import { initializeAppearancePreference } from './shared/preferences/useAppearancePreferences.js';
import { initializeCodeAppearancePreference } from './shared/preferences/useCodeAppearancePreferences.js';
import { initializeSidebarBackgroundPreference } from './shared/preferences/useSidebarBackgroundPreference.js';
import { initializeThemePreference } from './shared/preferences/useThemeTransition.js';
import './shared/styles/brand-icons.css';
import './shared/styles/code-theme.css';
import './shared/styles/file-icons.css';
import './shared/styles/loading-indicators.css';
import './shared/styles/primitives.css';
import './shared/styles/tokens.css';

applyDesktopPlatformAttribute();
initializeLocalePreference();
initializeThemePreference();
initializeAccentColorPreference();
initializeAppearancePreference();
initializeCodeAppearancePreference();
initializeSidebarBackgroundPreference();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
