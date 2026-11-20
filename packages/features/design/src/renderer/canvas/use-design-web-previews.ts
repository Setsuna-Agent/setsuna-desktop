import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DesignDocument, DesignWeb } from '../../contracts/index.js';
import type { DesignWebPreviewHost } from '../client.js';
import { intersectBounds, type Bounds } from '../design-geometry.js';
import type { DesignLayerBox, DesignScene } from '../design-layout.js';

export type DesignWebSession = Readonly<{ id: string; mode: 'inline' | 'expanded'; close(): void }>;
type Size = Pick<Bounds, 'width' | 'height'>;
type Device = DesignWebPreviewHost['devices'][number];
type AddressedWeb = DesignWeb & { url: string };

export type DesignWebLayer = Readonly<{
  id: string;
  node: AddressedWeb;
  box: DesignLayerBox;
}>;
export type DesignWebRequest = Readonly<DesignWebLayer & { key: string; device?: Device }>;
export type DesignWebSnapshotHandler = (id: string, key: string, url: string, image: HTMLImageElement | null, manual: boolean) => void;

type Snapshot = Readonly<{ key?: string; url: string; image: HTMLImageElement | null }>;
export type DesignWebImage = Readonly<{ image: HTMLImageElement; device?: Device }>;
export type DesignWebImages = ReadonlyMap<string, DesignWebImage>;
export type CaptureDesignWebImages = (layers: readonly DesignWebLayer[], signal: AbortSignal, networkAccess?: boolean) => Promise<DesignWebImages | undefined>;
type ExportCapture = Readonly<{ networkAccess: boolean; request: DesignWebRequest; onSnapshot: DesignWebSnapshotHandler }>;
const maxSnapshots = 24;

export function useDesignWebPreviews(host: DesignWebPreviewHost | undefined, document: DesignDocument, scene: DesignScene,
  range: Bounds, selectedId: string | undefined, session: DesignWebSession | undefined) {
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, Snapshot>>(() => new Map());
  const [manualRefresh, setManualRefresh] = useState<Pick<DesignWebRequest, 'id' | 'key'>>();
  // Prototype boards and exports share one capture guest. Cancelling one request leaves the others queued.
  const [captureQueue, setCaptureQueue] = useState<readonly ExportCapture[]>([]);
  const exportCapture = captureQueue[0];
  const requests = useMemo(() => {
    const next = new Map<string, DesignWebRequest>();
    if (!host) return next;
    for (const [id, node] of Object.entries(document.nodes)) {
      const box = scene[id];
      if (node.kind !== 'web' || !node.url || !box?.visible || !box.visibleBounds) continue;
      next.set(id, webSnapshotRequest({ id, node: { ...node, url: node.url }, box }, host.devices));
    }
    return next;
  }, [document, host, scene]);
  const latestRequests = useRef(requests);
  useLayoutEffect(() => { latestRequests.current = requests; }, [requests]);

  const images = useMemo<DesignWebImages>(() => {
    const available = new Map<string, DesignWebImage>();
    for (const [id, snapshot] of snapshots) {
      const request = requests.get(id);
      if (request && snapshot.image && snapshot.url === request.node.url) available.set(id, { image: snapshot.image, device: request.device });
    }
    return available;
  }, [requests, snapshots]);

  const live = session && requests.get(session.id);
  const liveId = live?.id;
  const invalidateSnapshot = useCallback((id: string) => {
    setSnapshots((previous) => {
      const snapshot = previous.get(id);
      if (!snapshot?.key) return previous;
      return new Map(previous).set(id, { ...snapshot, key: undefined });
    });
  }, []);
  useEffect(() => { if (liveId) invalidateSnapshot(liveId); }, [liveId, invalidateSnapshot]);

  const manual = manualRefresh && requests.get(manualRefresh.id);
  const forced = manual?.key === manualRefresh?.key ? manual : undefined;
  useEffect(() => {
    if (manualRefresh && !forced) setManualRefresh((current) => current === manualRefresh ? undefined : current);
  }, [manualRefresh, forced]);
  const pending = live || exportCapture ? undefined : forced ?? [...requests.values()]
    .flatMap((request) => {
      const visible = request.box.visibleBounds && intersectBounds(range, request.box.visibleBounds);
      if (!visible) return [];
      return [{ request, area: visible.width * visible.height }];
    })
    .sort((a, b) => Number(b.request.id === selectedId) - Number(a.request.id === selectedId) || b.area - a.area)
    .slice(0, maxSnapshots)
    .find(({ request }) => snapshots.get(request.id)?.key !== request.key)?.request;

  const record = useCallback<DesignWebSnapshotHandler>((id, key, url, image, manual) => {
    if (manual) setManualRefresh((current) => current?.id === id && current.key === key ? undefined : current);
    setSnapshots((previous) => {
      const next = new Map(previous);
      next.delete(id);
      next.set(id, { key, url, image });
      const oldest = next.keys().next().value;
      if (next.size > maxSnapshots && oldest) next.delete(oldest);
      return next;
    });
  }, []);
  const captureExportImages = useCallback<CaptureDesignWebImages>(async (layers, signal, networkAccess = true) => {
    if (!host) return;
    const images = new Map<string, DesignWebImage>();
    for (const layer of layers) {
      signal.throwIfAborted();
      const request = webSnapshotRequest(layer, host.devices);
      const snapshot = snapshots.get(request.id);
      let image = snapshot?.key === request.key ? snapshot.image : null;
      if (!image) {
        if (!networkAccess) throw new Error('Network access is required to load this web preview.');
        image = await new Promise<HTMLImageElement | null>((resolve, reject) => {
          const clear = () => {
            signal.removeEventListener('abort', abort);
            setCaptureQueue((queue) => queue.filter((queued) => queued !== job));
          };
          const abort = () => { clear(); reject(signal.reason); };
          const job: ExportCapture = { request, networkAccess, onSnapshot: (_id, _key, _url, image) => { clear(); resolve(image); } };
          signal.addEventListener('abort', abort, { once: true });
          setCaptureQueue((queue) => [...queue, job]);
        });
        signal.throwIfAborted();
        if (!image) return;
        // A document edit can replace the preview request while this export is waiting.
        if (latestRequests.current.get(request.id)?.key === request.key) record(request.id, request.key, request.node.url, image, false);
      }
      images.set(request.id, { image, device: request.device });
    }
    return images;
  }, [host, record, snapshots]);
  function refresh(id: string) {
    const request = requests.get(id);
    if (!request) return;
    setManualRefresh({ id, key: request.key });
    invalidateSnapshot(id);
  }
  return { request: live ?? pending, live: live ? session : undefined, images, record, refresh, exportCapture, captureExportImages,
    reportFailure: Boolean(!live && forced) };
}

function webSnapshotRequest(layer: DesignWebLayer, devices: readonly Device[]): DesignWebRequest {
  const device = devices.find((profile) => profile.id === layer.node.deviceId);
  const { width, height } = designWebViewport(layer.box, device, layer.node.zoom);
  return { ...layer, device, key: JSON.stringify([layer.node.url, device?.id, width, height]) };
}

export function fitDesignWebDevice(layer: Size, device?: Device): Bounds {
  if (!device) return { x: 0, y: 0, width: layer.width, height: layer.height };
  const fit = Math.min(layer.width / device.width, layer.height / device.height);
  const width = device.width * fit;
  const height = device.height * fit;
  return { x: (layer.width - width) / 2, y: (layer.height - height) / 2, width, height };
}

export function designWebViewport(layer: Size, device?: Device, zoom = 1): Size {
  const base = device ?? layer;
  // Changing the logical viewport makes page breakpoints respond to zoom without changing other guests at the same origin.
  const scale = Math.min(1 / zoom, 5120 / Math.max(base.width, base.height), Math.sqrt(8_000_000 / (base.width * base.height)));
  return { width: Math.max(1, Math.round(base.width * scale)), height: Math.max(1, Math.round(base.height * scale)) };
}
