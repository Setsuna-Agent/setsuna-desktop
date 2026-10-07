import { shell, type DownloadItem, type Extension, type Session } from 'electron';
import type { ExtensionSystemEvent } from '../../contracts/extension-api.js';

export class BrowserExtensionDownloads {
  private readonly items = new Map<number, Record<string, unknown>>();
  private readonly disposers = new Set<() => void>();
  private sequence = 0;
  constructor(private readonly session: Session, private readonly publish: (event: ExtensionSystemEvent) => void) {}

  start(): void { this.session.on('will-download', this.download); }
  call(extension: Extension, method: string, args: unknown[]): unknown {
    if (!extension.manifest.permissions?.includes('downloads')) throw new Error('downloads permission required.');
    if (method === 'show') {
      const item = this.items.get(args[0] as number);
      if (!item || typeof item.filename !== 'string' || !item.filename) throw new Error('Download unavailable.');
      shell.showItemInFolder(item.filename); return;
    }
    if (method !== 'search') throw new Error('Unsupported downloads operation.');
    const query = args[0] as { id?: number; urlRegex?: string; state?: string; limit?: number; orderBy?: string[] } | null;
    if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Invalid download query.');
    if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 0)) throw new Error('Invalid download limit.');
    const pattern = query.urlRegex === undefined ? null : new RegExp(query.urlRegex);
    let items = [...this.items.values()].filter((item) => (query.id === undefined || query.id === item.id)
      && (query.state === undefined || query.state === item.state) && (!pattern || pattern.test(String(item.url))));
    if (query.orderBy?.includes('-startTime')) items = items.reverse();
    return items.slice(0, query.limit || items.length);
  }

  dispose(): void {
    this.session.off('will-download', this.download);
    for (const dispose of this.disposers) dispose();
    this.disposers.clear(); this.items.clear();
  }

  private readonly download = (_event: Electron.Event, item: DownloadItem) => {
    const id = ++this.sequence;
    const snapshot = (state: string = item.getState()) => ({ id, url: item.getURL(), finalUrl: item.getURLChain().at(-1) ?? item.getURL(),
      filename: item.getSavePath(), mime: item.getMimeType(), startTime: new Date(item.getStartTime() * 1000).toISOString(),
      state: state === 'completed' ? 'complete' : state === 'progressing' ? 'in_progress' : 'interrupted',
      bytesReceived: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), fileSize: item.getTotalBytes(), paused: item.isPaused(),
      exists: true, canResume: item.canResume(), danger: 'safe', incognito: !this.session.isPersistent() });
    const current = snapshot(); this.items.set(id, current);
    this.publish({ kind: 'downloadCreated', item: current });
    const updated = (_event?: Electron.Event, state?: string) => {
      const previous = this.items.get(id) ?? {}; const next = snapshot(state); this.items.set(id, next);
      const delta: Record<string, unknown> = { id };
      for (const [key, value] of Object.entries(next)) if (key !== 'id' && value !== previous[key]) delta[key] = { previous: previous[key], current: value };
      if (Object.keys(delta).length > 1) this.publish({ kind: 'downloadChanged', delta });
    };
    const done = (_event: Electron.Event, state: string) => { updated(_event, state); dispose(); };
    const dispose = () => { item.off('updated', updated).off('done', done); this.disposers.delete(dispose); };
    this.disposers.add(dispose); item.on('updated', updated).once('done', done);
  };
}
