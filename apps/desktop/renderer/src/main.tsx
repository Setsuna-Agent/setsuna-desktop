import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-mono/400.css';
import 'antd/dist/reset.css';
import { App } from './App.js';
import { applyDesktopPlatformAttribute } from './utils/desktopPlatform.js';
import './styles/tokens.css';
import './styles/app.css';
import './styles/primitives.css';
import './styles/sidebar.css';
import './styles/workspace.css';
import './styles/bottom-panel.css';
import './styles/pages.css';
import './styles/settings.css';
import './styles/capabilities.css';
import './styles/chat.css';
import './styles/chat-composer.css';
import './styles/sidebar-search.css';

applyDesktopPlatformAttribute();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
