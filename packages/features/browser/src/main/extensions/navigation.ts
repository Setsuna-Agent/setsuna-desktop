import { randomUUID } from 'node:crypto';
import type { Extension, WebContents } from 'electron';
import type { ExtensionSystemEvent } from '../../contracts/extension-api.js';
import { extensionFrameId } from './frame-id.js';
import { isAllowedEmbeddedBrowserUrl } from '../new-tab.js';

type TargetRequest = { source: WebContents; url: string; sourceProcessId: number; timeStamp: number; timer: ReturnType<typeof setTimeout> };

export class BrowserExtensionNavigation {
  private readonly targets = new Map<string, TargetRequest>();
  constructor(private readonly guests: () => readonly WebContents[], private readonly publish: (event: ExtensionSystemEvent) => void) {}
  getAllFrames(extension: Extension, input: unknown): unknown {
    if (!extension.manifest.permissions?.includes('webNavigation')) throw new Error('webNavigation permission required.');
    const tabId = input && typeof input === 'object' ? (input as { tabId?: unknown }).tabId : undefined;
    const contents = this.guests().find((contents) => contents.id === tabId && !contents.isDestroyed() && /^(https?:|about:blank$)/.test(contents.getURL()));
    if (!contents) throw new Error('Browser tab unavailable.');
    return contents.mainFrame.framesInSubtree.map((frame) => ({ frameId: extensionFrameId(frame),
      parentFrameId: frame.parent ? extensionFrameId(frame.parent) : -1,
      processId: frame.processId, url: frame.url, errorOccurred: false }));
  }

  requestTarget(source: WebContents, url: string): string | undefined {
    if (!isAllowedEmbeddedBrowserUrl(url) || source.isDestroyed() || !this.guests().includes(source)
      || !source.hostWebContents || source.hostWebContents.isDestroyed()) return;
    const tabId = `browser-${randomUUID()}`;
    const timer = setTimeout(() => this.forgetTarget(tabId), 60_000);
    this.targets.set(tabId, { source, url, sourceProcessId: source.mainFrame.processId, timeStamp: Date.now(), timer });
    return tabId;
  }

  registerTarget(tabId: string, target: WebContents): void {
    const request = this.targets.get(tabId);
    if (!request) return;
    const { source } = request;
    const guests = this.guests();
    if (source.isDestroyed() || target.isDestroyed() || source === target || !guests.includes(source) || !guests.includes(target)
      || source.session !== target.session || !source.hostWebContents || source.hostWebContents !== target.hostWebContents) return;
    // Electron denies native windows and the renderer creates webviews instead. Match
    // the issued workspace ID once registration supplies the real target's native ID.
    this.forgetTarget(tabId);
    this.publish({ kind: 'navigationTargetCreated', details: { sourceTabId: source.id,
      sourceProcessId: request.sourceProcessId, sourceFrameId: 0, tabId: target.id, url: request.url, timeStamp: request.timeStamp } });
  }

  forget(contents: WebContents): void {
    for (const [tabId, request] of this.targets) if (request.source === contents) this.forgetTarget(tabId);
  }
  dispose(): void { for (const tabId of this.targets.keys()) this.forgetTarget(tabId); }
  private forgetTarget(tabId: string): void {
    const request = this.targets.get(tabId);
    if (request) { clearTimeout(request.timer); this.targets.delete(tabId); }
  }
}
