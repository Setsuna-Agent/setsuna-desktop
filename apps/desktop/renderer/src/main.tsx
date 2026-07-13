import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-mono/400.css';
import 'antd/dist/reset.css';
import 'katex/dist/katex.min.css';
import { App } from './App.js';
import { initializeAccentColorPreference } from './hooks/useAccentColorPreference.js';
import { initializeAppearancePreference } from './hooks/useAppearancePreferences.js';
import { initializeCodeAppearancePreference } from './hooks/useCodeAppearancePreferences.js';
import { initializeSidebarOpacityPreference } from './hooks/useSidebarOpacityPreference.js';
import { initializeThemePreference } from './hooks/useThemeTransition.js';
import { applyDesktopPlatformAttribute } from './utils/desktopPlatform.js';
import './styles/tokens.css';
import './styles/app.css';
import './styles/primitives.css';
import './styles/sidebar.css';
import './styles/panel-chrome.css';
import './styles/workspace.css';
import './styles/bottom-panel.css';
import './styles/settings.css';
import './styles/capabilities.css';
import './styles/chat.css';
import './styles/chat-timeline-divider.css';
import './styles/loading-indicators.css';
import './styles/markdown.css';
import './styles/chat-composer.css';
import './styles/sidebar-search.css';
import './styles/code-theme.css';

applyDesktopPlatformAttribute();
initializeThemePreference();
initializeAccentColorPreference();
initializeAppearancePreference();
initializeCodeAppearancePreference();
initializeSidebarOpacityPreference();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
