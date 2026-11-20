import { session, type Event, type Session, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PREVIEW_PARTITION } from '../contracts/browser-control.js';
import { BROWSER_IPC_CHANNELS, type BrowserWebPreviewSettings } from '../contracts/bridge.js';
import { browserDeviceProfiles } from '../contracts/device-profiles.js';
import type { BrowserDebuggerTransport } from './cdp/automation.js';
import { ElectronBrowserCdpDeviceEmulator, resolveBrowserUserAgentOverride } from './cdp/device-emulation.js';

const configured = new WeakSet<Session>();
type Preview = {
  userAgent: string;
  emulator?: ElectronBrowserCdpDeviceEmulator;
  device?: BrowserWebPreviewSettings['device'];
  url?: string;
  loading?: Promise<boolean>;
  interactive: boolean;
  operation: Promise<void>;
};
const previews = new WeakMap<WebContents, Preview>();

export function browserPreviewSession(): Session {
  const preview = session.fromPartition(DESKTOP_BROWSER_PREVIEW_PARTITION);
  if (!configured.has(preview)) {
    // Keep preview navigation outside browser profiles, saved credentials and permissions.
    preview.setPermissionCheckHandler(() => false);
    preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    preview.on('will-download', (event) => event.preventDefault());
    configured.add(preview);
  }
  return preview;
}

export function isBrowserPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

export function protectBrowserPreview(contents: WebContents) {
  const preview: Preview = { userAgent: contents.getUserAgent(), interactive: false, operation: Promise.resolve() };
  previews.set(contents, preview);
  contents.setAudioMuted(true);
  const filter = (event: Event, url: string, mainFrame: boolean) => {
    if (isBrowserPreviewUrl(url) || (!mainFrame && /^(?:about:(?:blank|srcdoc)$|blob:|data:)/u.test(url))) return;
    event.preventDefault();
  };
  contents.on('will-frame-navigate', (event) => filter(event, event.url, event.isMainFrame));
  contents.on('will-redirect', (event) => filter(event, event.url, event.isMainFrame));
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('before-input-event', (event, input) => {
    if (!preview.interactive || input.type !== 'keyDown' || input.key !== 'Escape' || input.alt || input.control || input.meta || input.shift) return;
    event.preventDefault();
    const owner = contents.hostWebContents;
    if (owner && !owner.isDestroyed()) owner.send(BROWSER_IPC_CHANNELS.webPreviewEscape, contents.id);
  });
  contents.once('destroyed', () => preview.emulator?.dispose());
}

export function configureBrowserWebPreview(contents: WebContents, settings: BrowserWebPreviewSettings, signal: AbortSignal): Promise<boolean> {
  const preview = previews.get(contents);
  const { url, device, interactive } = settings ?? {};
  if (!preview || typeof url !== 'string' || !isBrowserPreviewUrl(url) || typeof interactive !== 'boolean') return Promise.resolve(false);
  const profile = device && browserDeviceProfiles.find(({ id }) => id === device.id);
  if (device && (!profile?.width || !validDimension(device.width) || !validDimension(device.height))) return Promise.resolve(false);
  preview.interactive = interactive;
  contents.setAudioMuted(!interactive);
  const operation = preview.operation.then(async () => {
    if (signal.aborted || contents.isDestroyed()) return;
    const previous = preview.device;
    const changedProfile = previous?.id !== device?.id;
    if (device && profile?.width && profile.height
      && (changedProfile || previous?.width !== device.width || previous?.height !== device.height)) {
      contents.enableDeviceEmulation({
        deviceScaleFactor: profile.deviceScaleFactor,
        scale: 1,
        screenPosition: profile.mobile ? 'mobile' : 'desktop',
        screenSize: { width: profile.width, height: profile.height },
        viewPosition: { x: 0, y: 0 },
        viewSize: { width: device.width, height: device.height },
      });
    } else if (!device && previous) contents.disableDeviceEmulation();
    if (changedProfile) {
      const agent = resolveBrowserUserAgentOverride(profile?.userAgentProfile ?? 'desktop', preview.userAgent);
      contents.setUserAgent(agent?.userAgent ?? preview.userAgent);
      if (profile?.mobile || agent) {
        preview.emulator ??= new ElectronBrowserCdpDeviceEmulator(contents.debugger as unknown as BrowserDebuggerTransport);
        await preview.emulator.apply({ touch: Boolean(profile?.mobile), userAgent: agent });
      } else await preview.emulator?.apply(null);
    }
    if (signal.aborted || contents.isDestroyed()) return;
    preview.device = device;
    if (preview.url !== url || changedProfile) {
      const current = contents.getURL();
      const address = preview.url === url && isBrowserPreviewUrl(current) ? current : url;
      preview.url = url;
      // Serialize native device changes. A slow request must not delay the next device or URL selection.
      const loading = contents.loadURL(address).then(() => true, () => {
        if (preview.loading === loading) preview.url = undefined;
        return false;
      });
      preview.loading = loading;
    }
    return { loading: preview.loading };
  });
  preview.operation = operation.then(() => undefined, () => undefined);
  return untilPreviewCancelled(operation.then((result) => result?.loading ?? false, () => false), signal, false);
}

export async function captureBrowserWebPreview(contents: WebContents, signal: AbortSignal): Promise<string | null> {
  if (!previews.has(contents) || !isBrowserPreviewUrl(contents.getURL())) return null;
  try {
    const image = await untilPreviewCancelled(contents.capturePage(undefined, { stayHidden: true, stayAwake: true }), signal, null);
    if (!image || image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const maximum = 960;
    const thumbnail = Math.max(width, height) <= maximum ? image
      : image.resize(width >= height ? { width: maximum } : { height: maximum });
    return `data:image/jpeg;base64,${thumbnail.toJPEG(82).toString('base64')}`;
  } catch {
    return null;
  }
}

function validDimension(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 5120;
}

async function untilPreviewCancelled<T>(operation: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  let cancel: () => void = () => undefined;
  const cancelled = new Promise<T>((resolve) => {
    cancel = () => resolve(fallback);
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([cancelled, operation]); }
  finally { signal.removeEventListener('abort', cancel); }
}
