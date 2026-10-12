import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { dialog, type BrowserWindow, type Session, type WebContents, type WebFrameMain } from 'electron';

export type PluginPermissionDocument = { id: string; url: string; owner: BrowserWindow };
type Permission = 'camera' | 'microphone' | 'geolocation' | 'clipboard-read' | 'clipboard-write' | 'notifications';
type FramePermissions = { document: PluginPermissionDocument; grants: Set<Permission>; cancel?: () => void };

/** Session-wide denial with explicit, document-scoped grants for registered Plugin frames. */
export class PluginUiPermissions {
  private readonly frames = new Map<WebFrameMain, FramePermissions>();

  constructor(
    private readonly documentFor: (contents: WebContents, url: string) => PluginPermissionDocument | undefined,
    private readonly ownerFor: (contents: WebContents) => BrowserWindow | undefined,
    private readonly language: () => RuntimeInterfaceLanguage,
  ) {}

  install(session: Session): void {
    session.setPermissionCheckHandler((contents, permission, _origin, details) => {
      if (this.hostPermission(contents, session, permission, details.isMainFrame, details.requestingUrl)) return true;
      const target = this.target(contents, session, details.requestingUrl, details.isMainFrame);
      if (!target) return false;
      if (permission === 'fullscreen') return true;
      const permissions = requestedPermissions(permission, details.mediaType ? [details.mediaType] : undefined);
      const state = this.frames.get(target.frame);
      return permissions.length > 0 && state?.document.id === target.document.id
        && permissions.every(key => state.grants.has(key));
    });
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (this.hostPermission(contents, session, permission, details.isMainFrame, details.requestingUrl)) {
        callback(true); return;
      }
      const target = this.target(contents, session, details.requestingUrl, details.isMainFrame);
      if (!target) { callback(false); return; }
      if (permission === 'fullscreen') { callback(true); return; }
      const permissions = requestedPermissions(permission, 'mediaTypes' in details ? details.mediaTypes : undefined);
      if (!permissions.length) { callback(false); return; }
      const { document, frame } = target;
      let state = this.frames.get(frame);
      if (state?.document.id !== document.id) {
        this.revokeFrame(frame);
        state = { document, grants: new Set() };
        this.frames.set(frame, state);
      }
      if (permissions.every(key => state.grants.has(key))) { callback(true); return; }
      // Do not stack native prompts from concurrent requests in the same window.
      if ([...this.frames.values()].some(value => value.document.owner === document.owner && value.cancel)) {
        callback(false); return;
      }
      const grants = state;
      const abort = new AbortController();
      let answered = false;
      const finish = (accepted: boolean) => {
        if (answered) return;
        answered = true;
        grants.cancel = undefined;
        const current = this.target(contents, session, details.requestingUrl, details.isMainFrame);
        const allow = accepted && current?.frame === frame && current.document.id === document.id && this.frames.get(frame) === grants;
        // Chromium rechecks after the callback; publish the approved grant first.
        if (allow) for (const key of permissions) grants.grants.add(key);
        if (!grants.grants.size && this.frames.get(frame) === grants) this.frames.delete(frame);
        callback(allow);
      };
      grants.cancel = () => { finish(false); abort.abort(); };
      const zh = this.language() === 'zh-CN';
      const labels: Record<Permission, string> = zh
        ? { camera: '摄像头', microphone: '麦克风', geolocation: '位置', 'clipboard-read': '剪贴板（读取）', 'clipboard-write': '剪贴板（写入）', notifications: '通知' }
        : { camera: 'camera', microphone: 'microphone', geolocation: 'location', 'clipboard-read': 'clipboard (read)', 'clipboard-write': 'clipboard (write)', notifications: 'notifications' };
      const url = new URL(document.url);
      const origin = `${url.protocol}//${url.host}`;
      void dialog.showMessageBox(document.owner, {
        type: 'question', title: zh ? '插件页面权限' : 'Plugin page permission',
        message: zh ? `允许 ${origin} 使用${permissions.map(key => labels[key]).join('、')}？`
          : `Allow ${origin} to access ${permissions.map(key => labels[key]).join(', ')}?`,
        buttons: zh ? ['拒绝', '允许此次'] : ['Block', 'Allow once'], defaultId: 0, cancelId: 0, signal: abort.signal,
      }).then(({ response }) => finish(response === 1)).catch(() => finish(false));
    });
  }

  revokeDocument(id: string): void {
    for (const [frame, state] of this.frames) if (state.document.id === id) this.revokeFrame(frame);
  }

  revokeFrame(frame: WebFrameMain): void {
    const state = this.frames.get(frame);
    this.frames.delete(frame);
    state?.cancel?.();
  }

  private hostPermission(contents: WebContents | null, session: Session, permission: string, main: boolean, url?: string): boolean {
    if (!main || !contents || contents.isDestroyed() || contents.session !== session) return false;
    const owner = this.ownerFor(contents);
    // Preserve host copy/fullscreen actions without extending them to Plugin frames.
    return Boolean(owner && !owner.isDestroyed() && (!url || url === contents.getURL())
      && (permission === 'clipboard-sanitized-write' || permission === 'fullscreen'));
  }

  private target(contents: WebContents | null, session: Session, url: string | undefined, main: boolean) {
    if (main || !contents || !url || contents.isDestroyed() || contents.session !== session) return undefined;
    const document = this.documentFor(contents, url);
    if (!document || document.owner.isDestroyed()) return undefined;
    const matches = contents.mainFrame.framesInSubtree.filter(frame => !frame.detached && withoutHash(frame.url) === document.url);
    // Electron supplies a URL, not a frame ID. Ambiguous/nested copies cannot inherit a grant.
    const frame = matches.length === 1 ? matches[0] : undefined;
    return frame?.parent === contents.mainFrame ? { document, frame } : undefined;
  }
}

export function withoutHash(value: string): string {
  try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; }
}

function requestedPermissions(permission: string, mediaTypes?: readonly string[]): Permission[] {
  if (permission === 'media') {
    if (!mediaTypes?.length || mediaTypes.some(type => type !== 'audio' && type !== 'video')) return ['camera', 'microphone'];
    return [...new Set(mediaTypes.map(type => type === 'video' ? 'camera' as const : 'microphone' as const))];
  }
  if (permission === 'geolocation' || permission === 'notifications') return [permission];
  if (permission === 'clipboard-read' || permission === 'deprecated-sync-clipboard-read') return ['clipboard-read'];
  return permission === 'clipboard-sanitized-write' ? ['clipboard-write'] : [];
}
