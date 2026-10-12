import { createRoot } from 'react-dom/client';
import type { BrowserDesktopBridge } from '../../src/contracts/index.js';
import { BrowserPanel } from '../../src/renderer/BrowserPanel.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

const bridge = (window as unknown as { navigationFixture: BrowserDesktopBridge }).navigationFixture;
createRoot(document.body).render(<BrowserPanel
  bridge={bridge} hidden={false} notify={() => undefined} onPanelMetadataChange={() => undefined}
  panel={{ id: 'website-app', title: 'Website', browser: { url: 'https://web-app.test/startup', faviconUrl: null, loading: false } }}
  translate={(key, params) => translateBrowserMessage('en-US', key, params)} windowOpenMode="current-tab"
/>);
