import { dialog, type BrowserWindow, type Session, type WebContents } from 'electron';
import type { BrowserPermission, BrowserPermissionPolicy, BrowserPreferences } from '../../contracts/settings.js';
import { browserSiteOrigin, type BrowserPreferencesStore } from './preferences.js';

export function requestedBrowserPermissions(permission: string, mediaTypes?: readonly string[]): BrowserPermission[] {
  if (permission === 'media') {
    if (!mediaTypes?.length || mediaTypes.some((type) => !['audio', 'video'].includes(type))) return ['camera', 'microphone'];
    return mediaTypes.map((type) => type === 'video' ? 'camera' : 'microphone');
  }
  if (permission === 'geolocation' || permission === 'notifications') return [permission];
  return permission === 'clipboard-read' || permission === 'deprecated-sync-clipboard-read' ? ['clipboard'] : [];
}

export function browserPermissionPolicy(preferences: BrowserPreferences, origin: string, permissions: BrowserPermission[],
  grants?: ReadonlySet<BrowserPermission>): BrowserPermissionPolicy {
  const rules = permissions.map((permission) => {
    const policy = preferences.sitePermissions[origin]?.[permission] ?? preferences.permissions[permission];
    return policy === 'ask' && grants?.has(permission) ? 'allow' : policy;
  });
  return !rules.length || rules.includes('block') ? 'block' : rules.includes('ask') ? 'ask' : 'allow';
}

type PermissionDocument = {
  origin: string;
  grants: Set<BrowserPermission>;
  prompt?: { permissions: BrowserPermission[]; cancel(): void };
  dispose(): void;
};

export function installBrowserPermissions(session: Session, preferences: BrowserPreferencesStore,
  owner: (contents: WebContents) => BrowserWindow | null, language: () => string): () => void {
  const documents = new Map<WebContents, PermissionDocument>();
  let disposed = false;
  const documentFor = (contents: WebContents, origin: string): PermissionDocument => {
    const existing = documents.get(contents);
    if (existing?.origin === origin) return existing;
    existing?.dispose();
    const document: PermissionDocument = {
      origin, grants: new Set(),
      dispose() {
        if (documents.get(contents) !== document) return;
        documents.delete(contents);
        contents.off('did-start-navigation', navigating);
        contents.off('destroyed', destroy);
        contents.off('render-process-gone', destroy);
        document.grants.clear();
        document.prompt?.cancel();
      },
    };
    const destroy = () => document.dispose();
    // Same-document and child-frame navigation do not replace this document.
    const navigating = (_event: unknown, _url: string, inPlace: boolean, main: boolean) => { if (main && !inPlace) destroy(); };
    documents.set(contents, document);
    contents.on('did-start-navigation', navigating);
    contents.once('destroyed', destroy);
    contents.on('render-process-gone', destroy);
    return document;
  };
  let previousPreferences = preferences.get();
  const unsubscribe = preferences.subscribe((next) => {
    const previous = previousPreferences;
    previousPreferences = next;
    for (const document of [...documents.values()]) {
      const changed = (permission: BrowserPermission) => browserPermissionPolicy(previous, document.origin, [permission])
        !== browserPermissionPolicy(next, document.origin, [permission]);
      // Remove revoked grants eagerly so switching back to "ask" cannot revive them.
      for (const permission of document.grants) if (changed(permission)) document.grants.delete(permission);
      if (document.prompt?.permissions.some(changed)) document.prompt.cancel();
      if (!document.grants.size && !document.prompt) document.dispose();
    }
  });
  const trustedOrigin = (contents: WebContents | null, url: string, main: boolean) => {
    const origin = browserSiteOrigin(url);
    if (disposed || !main || !contents || contents.isDestroyed() || contents.session !== session) return null;
    const window = owner(contents);
    if (!window || window.isDestroyed()) return null;
    // Cross-origin frames and insecure remote origins never inherit a top-level grant.
    if (!origin || browserSiteOrigin(contents.getURL()) !== origin) return null;
    const site = new URL(origin);
    return site.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname) ? origin : null;
  };
  session.setPermissionCheckHandler((contents, permission, url, details) => {
    const origin = trustedOrigin(contents, url, details.isMainFrame);
    const document = contents ? documents.get(contents) : undefined;
    return Boolean(origin && browserPermissionPolicy(preferences.get(), origin,
      requestedBrowserPermissions(permission, details.mediaType ? [details.mediaType] : undefined),
      document?.origin === origin ? document.grants : undefined) === 'allow');
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = trustedOrigin(contents, details.requestingUrl, details.isMainFrame);
    const permissions = requestedBrowserPermissions(permission, 'mediaTypes' in details ? details.mediaTypes : undefined);
    if (!origin) { callback(false); return; }
    const current = documents.get(contents);
    const policy = browserPermissionPolicy(preferences.get(), origin, permissions, current?.origin === origin ? current.grants : undefined);
    if (policy !== 'ask') { callback(policy === 'allow'); return; }
    const window = owner(contents);
    if (!window || window.isDestroyed() || current?.prompt) { callback(false); return; }
    const document = documentFor(contents, origin);
    let answered = false;
    const finish = (allow: boolean) => {
      if (answered) return;
      answered = true;
      document.prompt = undefined;
      // Chromium checks permission again after the callback, so publish the grant first.
      if (allow) for (const key of permissions) {
        if (browserPermissionPolicy(preferences.get(), origin, [key]) === 'ask') document.grants.add(key);
      }
      if (!document.grants.size) document.dispose();
      callback(allow);
    };
    document.prompt = { permissions, cancel: () => finish(false) };
    const zh = language() === 'zh-CN';
    const labels: Record<BrowserPermission, string> = zh
      ? { camera: '摄像头', microphone: '麦克风', geolocation: '位置', notifications: '通知', clipboard: '剪贴板' }
      : { camera: 'camera', microphone: 'microphone', geolocation: 'location', notifications: 'notifications', clipboard: 'clipboard' };
    void dialog.showMessageBox(window, {
      type: 'question', title: zh ? '网站权限' : 'Website permission',
      message: zh ? `允许 ${origin} 访问${permissions.map((key) => labels[key]).join('、')}？` : `Allow ${origin} to access ${permissions.map((key) => labels[key]).join(', ')}?`,
      buttons: zh ? ['拒绝', '允许此次'] : ['Block', 'Allow once'], defaultId: 0, cancelId: 0,
    }).then(({ response }) => finish(response === 1 && trustedOrigin(contents, details.requestingUrl, details.isMainFrame) === origin
      && browserPermissionPolicy(preferences.get(), origin, permissions) !== 'block'))
      .catch(() => finish(false));
  });
  return () => {
    disposed = true;
    unsubscribe();
    for (const document of [...documents.values()]) document.dispose();
    // Keep draining guests denied rather than restoring Electron's permissive default.
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  };
}
