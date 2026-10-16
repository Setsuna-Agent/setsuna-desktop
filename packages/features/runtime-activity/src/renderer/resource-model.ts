import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ProcessResourceSample, ProcessResourceSnapshot } from '../contracts/index.js';

export type ProcessResourceUsage = ProcessResourceSample & Readonly<{ cpuPercent: number | null }>;

export function resourceProcessName(item: ProcessResourceSample, t: RendererTranslate): string {
  const pages = [...new Set(item.pages.map(page => page.title.trim() || page.url.trim()).filter(Boolean))];
  if (pages.length) return pages.join(' · ');
  if (item.name) return item.name;
  if (item.type === 'Tab') return t(item.pages.length
    ? 'feature.runtimeActivity.resources.unnamedPage' : 'feature.runtimeActivity.resources.unassociatedPage');
  if (item.type === 'Browser') return 'Setsuna Desktop';
  if (item.type === 'GPU') return t('feature.runtimeActivity.resources.graphicsService');
  return t('feature.runtimeActivity.resources.unnamedProcess');
}

export function processResourceUsage(snapshot: ProcessResourceSnapshot, previous: ProcessResourceSnapshot | null): ProcessResourceUsage[] {
  const beforeByPid = new Map(previous?.processes.map((item) => [item.pid, item]));
  const elapsedSeconds = previous ? (snapshot.sampledAt - previous.sampledAt) / 1000 : 0;
  return snapshot.processes.map((item) => {
    const before = beforeByPid.get(item.pid);
    let cpuPercent: number | null = null;
    if (before && before.startedAt === item.startedAt && elapsedSeconds > 0) {
      if (item.cpuTimeSeconds !== null && before.cpuTimeSeconds !== null) {
        const used = item.cpuTimeSeconds - before.cpuTimeSeconds;
        if (used >= 0) cpuPercent = used / elapsedSeconds * 100;
      }
    }
    return { ...item, cpuPercent };
  });
}

export function mergeResourceProcesses(desktop: readonly ProcessResourceUsage[], runtime: readonly ProcessResourceUsage[]): ProcessResourceUsage[] {
  const processes = new Map(desktop.map((item) => [item.pid, item]));
  // Some Electron launch modes also report the runtime. Never count that PID twice.
  for (const item of runtime) processes.set(item.pid, item);
  return [...processes.values()].sort((left, right) => right.residentBytes - left.residentBytes || left.pid - right.pid);
}
