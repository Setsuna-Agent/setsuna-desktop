import { webContents, type Extension, type WebContents, type WebFrameMain } from 'electron';
import type { ContentScriptExecution } from '../../contracts/user-scripts.js';
import type { BrowserExtensionActiveTabs } from './active-tabs.js';
import { extensionFrameId } from './frame-id.js';
import { scriptSources } from './user-scripts/store.js';

type Run = (extensionId: string, contents: WebContents, frame: WebFrameMain, world: ContentScriptExecution['world'], code: string[], injectImmediately: boolean) => Promise<unknown>;
type Injection = { target?: { tabId?: number; allFrames?: boolean; frameIds?: number[] }; world?: ContentScriptExecution['world'];
  func?: string; args?: unknown[]; files?: string[]; injectImmediately?: boolean };

/** Native scripting stays first; only an actual activeTab grant can authorize this fallback. */
export class BrowserExtensionScripting {
  constructor(private readonly activeTabs: BrowserExtensionActiveTabs, private readonly run: Run) {}

  async execute(extension: Extension, raw: unknown): Promise<{ handled: false } | { handled: true; result: unknown[] }> {
    if (!extension.manifest.permissions?.includes('scripting') || !raw || typeof raw !== 'object' || Array.isArray(raw)) return { handled: false };
    const input = raw as Injection;
    const contents = typeof input.target?.tabId === 'number' ? webContents.fromId(input.target.tabId) : null;
    if (!contents || !this.activeTabs.has(extension.id, contents)) return { handled: false };
    if (Object.keys(input).some(key => !['target', 'world', 'func', 'args', 'files', 'injectImmediately'].includes(key))
      || !input.target || Object.keys(input.target).some(key => !['tabId', 'allFrames', 'frameIds'].includes(key))
      || input.target.allFrames !== undefined && typeof input.target.allFrames !== 'boolean'
      || input.target.frameIds !== undefined && (!Array.isArray(input.target.frameIds) || !input.target.frameIds.length
        || !input.target.frameIds.every(id => Number.isSafeInteger(id) && id >= 0))
      || input.target.allFrames && input.target.frameIds || input.injectImmediately !== undefined && typeof input.injectImmediately !== 'boolean'
      || input.world !== undefined && !['MAIN', 'ISOLATED'].includes(input.world)) throw new Error('Invalid script injection.');
    const hasFunction = typeof input.func === 'string';
    const hasFiles = Array.isArray(input.files) && input.files.length > 0 && input.files.every(file => typeof file === 'string');
    if (hasFunction === hasFiles || hasFunction && input.files !== undefined || hasFiles && input.func !== undefined
      || input.args !== undefined && (!hasFunction || !Array.isArray(input.args))) throw new Error('Invalid script sources.');
    const code = hasFunction ? [`(${input.func})(...${JSON.stringify(input.args ?? [])})`]
      : scriptSources(extension, input.files!.map(file => ({ file })));
    const frames = contents.mainFrame.framesInSubtree.filter(frame => !frame.isDestroyed()
      && (input.target!.allFrames || input.target!.frameIds?.includes(extensionFrameId(frame))
        || !input.target!.frameIds && frame.parent === null));
    if (!frames.length || input.target.frameIds?.some(id => !frames.some(frame => extensionFrameId(frame) === id))) throw new Error('Requested frame unavailable.');
    const origin = new URL(contents.getURL()).origin;
    // activeTab covers the main frame's origin, never a cross-origin child frame.
    if (frames.some(frame => frame.origin !== origin)) throw new Error('Cannot access contents of the frame.');
    if (!this.activeTabs.has(extension.id, contents)) return { handled: false };
    return { handled: true, result: await Promise.all(frames.map(frame => this.run(extension.id, contents, frame,
      input.world ?? 'ISOLATED', code, input.injectImmediately === true))) };
  }
}
