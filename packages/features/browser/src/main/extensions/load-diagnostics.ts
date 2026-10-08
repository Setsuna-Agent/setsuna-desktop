import path from 'node:path';
import type { Extension } from 'electron';
import { BRIDGED_EXTENSION_PERMISSIONS } from './capabilities.js';

const routes = new Set<(message: string) => boolean>();
let restoreWarnings: (() => void) | null = null;

function addRoute(route: (message: string) => boolean): void {
  if (!routes.size) {
    const original = process.emitWarning;
    // Electron emits validation warnings through process.emitWarning and offers no
    // per-load diagnostic callback. Route only our installed extensions' known warnings.
    const emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      const type = warning instanceof Error ? warning.name
        : typeof args[0] === 'object' && args[0] !== null ? (args[0] as { type?: string }).type : args[0];
      if (type === 'ExtensionLoadWarning' && !process.traceProcessWarnings) {
        const message = typeof warning === 'string' ? warning : warning.message;
        for (const handle of routes) {
          try { if (handle(message)) return; }
          catch { /* Diagnostic failures must preserve the original warning and load behavior. */ }
        }
      }
      return Reflect.apply(original, process, [warning, ...args]);
    }) as typeof process.emitWarning;
    process.emitWarning = emitWarning;
    restoreWarnings = () => { if (process.emitWarning === emitWarning) process.emitWarning = original; };
  }
  routes.add(route);
}

/** Native manifest diagnostics are distinct from failures of the compatibility APIs. */
export class BrowserExtensionLoadDiagnostics {
  private readonly reported = new Set<string>();
  private readonly paths: typeof path;
  constructor(private readonly options: {
    directory: string; resolve(id: string): Extension | null; report(message: string): void;
  }) {
    this.paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(options.directory) ? path.win32 : path;
  }

  start(): void { if (!routes.has(this.route)) addRoute(this.route); }
  dispose(): void {
    if (routes.delete(this.route) && !routes.size) { restoreWarnings?.(); restoreWarnings = null; }
    this.reported.clear();
  }

  private readonly route = (message: string): boolean => {
    const match = /^Warnings loading extension at (.+):\r?\n([\s\S]+)$/.exec(message);
    if (!match || !this.paths.isAbsolute(match[1])) return false;
    const relative = this.paths.relative(this.options.directory, match[1]);
    if (!relative || relative === '..' || relative.startsWith(`..${this.paths.sep}`) || this.paths.isAbsolute(relative)) return false;
    const extension = this.options.resolve(relative.split(this.paths.sep)[0]);
    if (!extension || this.paths.relative(extension.path, match[1])) return false;
    const unavailable: string[] = [];
    for (const line of match[2].split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      const permission = /^Permission '([^']+)' is unknown\.$/.exec(line)?.[1];
      if (permission) {
        if (!BRIDGED_EXTENSION_PERMISSIONS.has(permission)) unavailable.push(permission);
      } else if (line === "'webRequestBlocking' requires manifest version of 2 or lower.") {
        unavailable.push('webRequestBlocking (Manifest V3)');
      } else return false; // Unexpected manifest warnings retain their original diagnostics.
    }
    if (unavailable.length) {
      const missing = [...new Set(unavailable)];
      const key = JSON.stringify([extension.path, missing]);
      if (!this.reported.has(key)) {
        const name = extension.name.replace(/\s+/g, ' ').slice(0, 160);
        this.options.report(`[browser-extensions] ${name} (${extension.id}): unsupported permissions: ${missing.join(', ')}`);
        this.reported.add(key);
      }
    }
    return true;
  };
}
