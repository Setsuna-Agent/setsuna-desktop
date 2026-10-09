import { contextBridge } from 'electron';

/** Electron's native MV2 background pages share their preload's world. */
export function executeInExtensionWorld<Args extends unknown[], Result>(func: (...args: Args) => Result, args: Args): Result {
  return process.contextIsolated ? contextBridge.executeInMainWorld({ func, args }) : func(...args);
}
