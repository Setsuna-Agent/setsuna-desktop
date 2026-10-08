import path from 'node:path';
import type { Extension } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserExtensionLoadDiagnostics } from '../../../src/main/extensions/load-diagnostics.js';

const directory = path.resolve('/browser/Extensions');
const id = 'a'.repeat(32);
const installed: Extension = { id, name: 'Extension', version: '1.0.0', url: `chrome-extension://${id}/`,
  path: path.join(directory, id, '1.0.0_0'), manifest: { manifest_version: 3 } };
const services: BrowserExtensionLoadDiagnostics[] = [];
const traceDescriptor = Object.getOwnPropertyDescriptor(process, 'traceProcessWarnings');

function start(extension = installed) {
  const report = vi.fn();
  const paths = /^[a-z]:[\\/]/i.test(extension.path) ? path.win32 : path;
  const service = new BrowserExtensionLoadDiagnostics({ directory: paths.dirname(paths.dirname(extension.path)),
    resolve: value => value === extension.id ? extension : null, report });
  services.push(service); service.start();
  return { service, report };
}

function warning(lines: string[], location = installed.path) {
  return `Warnings loading extension at ${location}:\n${lines.map(value => `  ${value}`).join('\n')}\n`;
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  if (traceDescriptor) Object.defineProperty(process, 'traceProcessWarnings', traceDescriptor);
  else Reflect.deleteProperty(process, 'traceProcessWarnings');
  vi.restoreAllMocks();
});

it('omits bridged permission warnings and reports real unsupported capabilities once per installation', () => {
  const original = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  const { report } = start();
  process.emitWarning(warning(["Permission 'cookies' is unknown.", "Permission 'sidePanel' is unknown."]), 'ExtensionLoadWarning');
  expect(original).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  const message = warning(["Permission 'bookmarks' is unknown.", "Permission 'notifications' is unknown.",
    "Permission 'history' is unknown.", "'webRequestBlocking' requires manifest version of 2 or lower."]);
  process.emitWarning(message, 'ExtensionLoadWarning');
  process.emitWarning(message, { type: 'ExtensionLoadWarning' });
  expect(report).toHaveBeenCalledExactlyOnceWith(`[browser-extensions] Extension (${id}): unsupported permissions: notifications, history, webRequestBlocking (Manifest V3)`);
  expect(original).not.toHaveBeenCalled();
  process.emitWarning(warning(["Permission 'aFutureApi' is unknown."]), 'ExtensionLoadWarning');
  expect(report).toHaveBeenCalledTimes(2);
});

it('preserves unrelated warnings, unknown manifest problems and paths outside the managed installation', () => {
  const original = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  const { report } = start();
  const listenerWarning = Object.assign(new Error('11 closed listeners'), { name: 'MaxListenersExceededWarning' });
  const malformed = warning(["Permission 'cookies' is unknown.", 'Invalid content security policy.']);
  const external = warning(["Permission 'cookies' is unknown."], path.join(`${directory}-other`, id, '1.0.0_0'));
  const traversal = warning(["Permission 'cookies' is unknown."], path.join(directory, '..', 'other', id, '1.0.0_0'));
  const wrongInstallation = warning(["Permission 'cookies' is unknown."], path.join(directory, id, '2.0.0_0'));
  process.emitWarning(listenerWarning);
  for (const message of [malformed, external, traversal, wrongInstallation, 'Unrecognized diagnostic format']) {
    process.emitWarning(message, { type: 'ExtensionLoadWarning', code: 'EXT_LOAD' });
    expect(original).toHaveBeenLastCalledWith(message, { type: 'ExtensionLoadWarning', code: 'EXT_LOAD' });
  }
  expect(original).toHaveBeenCalledWith(listenerWarning);
  expect(original).toHaveBeenCalledTimes(6); expect(report).not.toHaveBeenCalled();
});

it('shares routing across services, normalizes Windows paths and restores the original emitter after disposal', () => {
  const original = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  const first = start(); first.service.start();
  const windows = { ...installed, id: 'b'.repeat(32), path: `C:\\Data\\Extensions\\${'b'.repeat(32)}\\1.0.0_0` };
  const second = start(windows);
  const emitter = process.emitWarning;
  first.service.dispose(); first.service.dispose();
  expect(process.emitWarning).toBe(emitter);
  const error = Object.assign(new Error(warning(["Permission 'cookies' is unknown."], windows.path.replaceAll('\\', '/').toLowerCase())), { name: 'ExtensionLoadWarning' });
  process.emitWarning(error);
  expect(original).not.toHaveBeenCalled();
  second.service.dispose();
  expect(process.emitWarning).toBe(original);
  process.emitWarning(error); expect(original).toHaveBeenCalledExactlyOnceWith(error);
});

it('retains complete native diagnostics when warning tracing is enabled', () => {
  const original = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  const { report } = start();
  Object.defineProperty(process, 'traceProcessWarnings', { configurable: true, value: true });
  const message = warning(["Permission 'cookies' is unknown.", "Permission 'notifications' is unknown."]);
  process.emitWarning(message, 'ExtensionLoadWarning');
  expect(original).toHaveBeenCalledExactlyOnceWith(message, 'ExtensionLoadWarning');
  expect(report).not.toHaveBeenCalled();
});
