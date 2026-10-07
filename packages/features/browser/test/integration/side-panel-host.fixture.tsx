import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { BrowserDesktopBridge, BrowserExtension, BrowserExtensionPanel } from '../../src/contracts/index.js';
import { BrowserExtensionPanelHost } from '../../src/renderer/extensions/BrowserExtensionPanelHost.js';
import { useBrowserExtensionPanelSlot } from '../../src/renderer/extensions/useBrowserExtensionPanelSlot.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

const fixture = window as unknown as {
  configuration: { extension: BrowserExtension; panel: BrowserExtensionPanel };
  panelFixture: { select(id: string | null): void; removeFirst(): void; close(): void; reopen(): void };
};
const translate = (key: Parameters<typeof translateBrowserMessage>[1]) => translateBrowserMessage('en-US', key);
const subscribers = new Set<() => void>();
let descriptor: BrowserExtensionPanel | null = fixture.configuration.panel;
const bridge = {
  getExtensionPanel: async () => descriptor,
  onExtensionPanelChanged: (callback: () => void) => { subscribers.add(callback); return () => subscribers.delete(callback); },
  getExtensions: async () => [fixture.configuration.extension],
  onExtensionsChanged: () => () => undefined,
} as unknown as BrowserDesktopBridge;

function Slot({ id, visible }: { id: string; visible: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const slot = useBrowserExtensionPanelSlot({ id, visible, webContentsId: id === 'first' ? 101 : 102, contentRef, translate });
  return <section hidden={!visible} style={{ display: visible ? 'flex' : 'none', height: '100vh' }}>
    <div ref={contentRef} style={{ flex: 1 }} />
    <div ref={slot.slotRef} style={{ width: slot.width }} />
  </section>;
}

function Fixture() {
  const [active, setActive] = useState<string | null>('first');
  const [first, setFirst] = useState(true);
  fixture.panelFixture = {
    select: (id) => flushSync(() => setActive(id)),
    removeFirst: () => flushSync(() => setFirst(false)),
    close: () => { descriptor = null; for (const callback of subscribers) callback(); },
    reopen: () => { descriptor = fixture.configuration.panel; for (const callback of subscribers) callback(); },
  };
  return <BrowserExtensionPanelHost bridge={bridge} notify={() => { throw new Error('Unexpected extension error'); }}>
    {first ? <Slot id="first" visible={active === 'first'} /> : null}
    <Slot id="second" visible={active === 'second'} />
  </BrowserExtensionPanelHost>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
