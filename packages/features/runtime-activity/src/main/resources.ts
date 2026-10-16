import type { ProcessMetric, WebContents } from 'electron';
import type { ProcessResourceSnapshot, ResourceProcessTarget, ResourceProcessTermination } from '../contracts/index.js';

export function projectDesktopResources(metrics: readonly ProcessMetric[], contents: readonly WebContents[], isRendererSender: (id: number) => boolean): ProcessResourceSnapshot {
  const pagesByPid = new Map<number, Map<number, { id: number; title: string; url: string }>>();
  const protectedPids = new Set<number>();
  const guestPids = new Set<number>();
  let complete = true;
  for (const page of contents) {
    // Terminated guests stay reloadable, but their disposed frames no longer own a process.
    if (page.isDestroyed() || page.isCrashed()) continue;
    try {
      const description = { id: page.id, title: page.getTitle(), url: page.getURL() };
      const mainPid = page.getOSProcessId();
      const mainFrame = page.mainFrame;
      // Electron also traverses embedded webviews here. Count only this page's
      // own frame tree, including its out-of-process iframes, to keep guest and host ownership separate.
      const pids = new Set([mainPid, ...mainFrame.framesInSubtree
        .filter(frame => !frame.isDestroyed() && frame.top === mainFrame).map(frame => frame.osProcessId)]);
      const owner = page.hostWebContents;
      const managedGuest = page.getType() === 'webview' && owner && !owner.isDestroyed() && isRendererSender(owner.id);
      if (managedGuest) guestPids.add(mainPid);
      for (const pid of pids) {
        if (pid <= 0) continue;
        if (!managedGuest) protectedPids.add(pid);
        const pages = pagesByPid.get(pid) ?? new Map();
        pages.set(page.id, description);
        pagesByPid.set(pid, pages);
      }
    } catch {
      // A page can close or replace its process during this on-demand snapshot.
      // Incomplete membership cannot authorize killing a potentially shared process.
      complete = false;
    }
  }
  return {
    sampledAt: performance.now(),
    processes: metrics.map((metric) => ({
      pid: metric.pid,
      startedAt: metric.creationTime,
      type: metric.type,
      name: metric.name || metric.serviceName || '',
      cpuTimeSeconds: metric.cpu.cumulativeCPUUsage ?? null,
      residentBytes: metric.memory.workingSetSize * 1024,
      canTerminate: complete && metric.type === 'Tab' && guestPids.has(metric.pid) && !protectedPids.has(metric.pid),
      pages: [...(pagesByPid.get(metric.pid)?.values() ?? [])],
    })),
  };
}

/** Revalidate identity and every affected page immediately before the native action. */
export function terminateResourceProcess(metrics: readonly ProcessMetric[], contents: readonly WebContents[],
  isRendererSender: (id: number) => boolean, input: unknown): ResourceProcessTermination {
  const target = input as ResourceProcessTarget | null;
  if (!target || !Number.isSafeInteger(target.pid) || target.pid <= 0 || !Number.isFinite(target.startedAt)
    || !Array.isArray(target.pageIds) || !target.pageIds.length
    || target.pageIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || new Set(target.pageIds).size !== target.pageIds.length) throw new Error('Invalid resource process target.');
  const current = projectDesktopResources(metrics, contents, isRendererSender).processes.find(item => item.pid === target.pid);
  if (!current || current.startedAt !== target.startedAt) return 'stale';
  if (!current.canTerminate) return 'protected';
  if (current.pages.length !== target.pageIds.length || current.pages.some(page => !target.pageIds.includes(page.id))) return 'stale';
  const guest = contents.find(page => !page.isDestroyed() && page.getOSProcessId() === current.pid);
  if (!guest) return 'stale';
  // This API addresses an owned WebContents, never an arbitrary OS PID. Shared
  // guest pages are included in the confirmed membership above; host processes are excluded.
  guest.forcefullyCrashRenderer();
  return 'terminated';
}
