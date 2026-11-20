import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { parseDesignWebUrl } from '../../contracts/index.js';
import type { DesignWebPreviewHost } from '../client.js';
import type { Bounds } from '../design-geometry.js';
import { designStrokeOutset, layerCornerRadius, visibleDesignStrokes } from '../design-paint.js';
import type { CanvasViewport } from '../use-design-canvas-gestures.js';
import { designWebViewport, fitDesignWebDevice, type DesignWebRequest, type DesignWebSession, type DesignWebSnapshotHandler } from './use-design-web-previews.js';

type Size = Pick<Bounds, 'width' | 'height'>;
type PreviewGuest = HTMLWebViewElement & { getWebContentsId(): number; getURL(): string; reload(): void };
export type DesignWebPreviewHandle = Readonly<{ reload(): boolean }>;

type PreviewProps = Readonly<{
  request: DesignWebRequest;
  session?: DesignWebSession;
  viewport: CanvasViewport;
  size: Size;
  expandedSize: Size;
  host: DesignWebPreviewHost;
  reportFailure: boolean;
  onSnapshot: DesignWebSnapshotHandler;
  onNavigate(id: string, source: string, address: string | undefined): void;
  translate: RendererTranslate;
}>;

export const DesignWebPreview = forwardRef<DesignWebPreviewHandle, PreviewProps>(function DesignWebPreview({
  request, session, viewport, size, expandedSize, host, reportFailure, onSnapshot, onNavigate, translate: t,
}, ref) {
  const webview = useRef<PreviewGuest>(null);
  const manualReload = useRef<AbortController>();
  const [guestId, setGuestId] = useState<number>();
  const toast = useToast();
  const { node, box, device } = request;
  const live = Boolean(session);
  const expanded = session?.mode === 'expanded';
  const frame = expanded ? expandedSize : box;
  const page = designWebViewport(frame, device, node.zoom);
  const fit = fitDesignWebDevice(frame, device);
  const { key, id, node: { url } } = request;
  const deviceId = device?.id;
  const deviceWidth = deviceId ? page.width : 0;
  const deviceHeight = deviceId ? page.height : 0;
  const close = session?.close;

  useImperativeHandle(ref, () => ({
    reload() {
      const guest = webview.current;
      if (!live || guestId === undefined || !guest?.isConnected) return false;
      try { parseDesignWebUrl(guest.getURL()); }
      catch { return false; }

      manualReload.current?.abort();
      const attempt = new AbortController();
      manualReload.current = attempt;
      const report = () => {
        if (attempt.signal.aborted) return;
        attempt.abort();
        toast.error(t('feature.design.webLoadFailed'));
      };
      guest.addEventListener('did-fail-load', (event: Event) => {
        const { errorCode, isMainFrame } = event as Event & { errorCode?: number; isMainFrame?: boolean };
        if (isMainFrame && errorCode !== -3) report();
      }, { signal: attempt.signal });
      guest.addEventListener('did-stop-loading', () => attempt.abort(), { once: true, signal: attempt.signal });
      try { guest.reload(); }
      catch { report(); }
      return true;
    },
  }), [guestId, live, t, toast]);

  useLayoutEffect(() => () => manualReload.current?.abort(), [live, url, deviceId]);

  useLayoutEffect(() => {
    const guest = webview.current;
    if (!guest) return;
    const ready = () => { setGuestId(guest.getWebContentsId()); };
    guest.addEventListener('dom-ready', ready, { once: true });
    return () => guest.removeEventListener('dom-ready', ready);
  }, []);

  useEffect(() => {
    if (guestId === undefined || !close) return;
    return host.onEscape((senderId) => { if (senderId === guestId) close(); });
  }, [close, guestId, host]);

  useEffect(() => {
    const guest = webview.current;
    if (!live || !guest) return;
    const updateAddress = (event: Event) => {
      const { url: address, isMainFrame } = event as Event & { url?: string; isMainFrame?: boolean };
      if (!address || isMainFrame === false) return;
      try { onNavigate(id, url, parseDesignWebUrl(address)); }
      catch { /* Leave the address unchanged for non-web guest events. */ }
    };
    guest.addEventListener('did-navigate', updateAddress);
    guest.addEventListener('did-navigate-in-page', updateAddress);
    return () => {
      guest.removeEventListener('did-navigate', updateAddress);
      guest.removeEventListener('did-navigate-in-page', updateAddress);
      onNavigate(id, url, undefined);
    };
  }, [id, live, onNavigate, url]);

  useEffect(() => {
    let cancelled = false;
    const finish = (image: HTMLImageElement | null) => {
      if (cancelled) return;
      cancelled = true;
      onSnapshot(id, key, url, image, reportFailure);
    };
    const failed = () => {
      if (cancelled) return;
      if (close || reportFailure) toast.error(t('feature.design.webLoadFailed'));
      if (close) close();
      else finish(null);
    };
    // A slow site can occupy the capture slot briefly, then the remaining web layers continue loading.
    const timeout = live ? undefined : window.setTimeout(failed, 10_000);
    if (guestId !== undefined) {
      void (async () => {
        const ready = await host.configure(guestId, {
          url, interactive: live, device: deviceId ? { id: deviceId, width: deviceWidth, height: deviceHeight } : undefined,
        });
        if (cancelled) return;
        if (!ready) return failed();
        if (live) return;
        const data = await host.capture(guestId);
        if (cancelled) return;
        if (!data) return failed();
        const image = new Image();
        image.src = data;
        await image.decode();
        finish(image);
      })().catch(failed);
    }
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [close, deviceHeight, deviceId, deviceWidth, guestId, host, id, key, live, onSnapshot, reportFailure, t, toast, url]);

  const { scale, x, y } = viewport;
  const visible = box.visibleBounds;
  const clip = live && !expanded && visible ? [y + visible.y * scale, size.width - x - (visible.x + visible.width) * scale,
    size.height - y - (visible.y + visible.height) * scale, x + visible.x * scale] : undefined;
  const radius = layerCornerRadius(node, box.width, box.height);
  const strokeInset = live && !expanded ? Math.max(0, ...visibleDesignStrokes(node)
    .map(({ width, alignment }) => width - designStrokeOutset(width, alignment))) : 0;
  const radiusInset = (value: number) => `${Math.max(0, value - strokeInset)}px`;
  const innerRadius = Array.isArray(radius) ? radius.map(radiusInset).join(' ') : radiusInset(radius);

  return <div className="design-web-preview" data-expanded={expanded || undefined}
    style={{ clipPath: clip && `inset(${clip.map((px) => `${Math.max(0, px)}px`).join(' ')})` }}>
    <div className="design-web-preview__surface" data-live={live || undefined}
      style={expanded ? undefined : {
        left: live ? x + box.absoluteX * scale : 0, top: live ? y + box.absoluteY * scale : 0,
        width: box.width, height: box.height, opacity: live ? node.opacity : 0,
        clipPath: live ? `inset(${strokeInset}px round ${innerRadius})` : undefined,
        transform: live ? `rotate(${box.angle}deg) scale(${scale * box.scaleX}, ${scale * box.scaleY})` : undefined,
      }}>
      <webview ref={webview} aria-hidden={!live} aria-label={node.name || t('feature.design.web')}
        tabIndex={live ? 0 : -1} partition={host.partition} src="about:blank"
        style={{ left: fit.x, top: fit.y, width: page.width, height: page.height,
          transform: `scale(${fit.width / page.width}, ${fit.height / page.height})` }} />
    </div>
  </div>;
});
