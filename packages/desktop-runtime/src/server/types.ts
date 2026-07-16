import type { AddressInfo } from 'node:net';
import type { createRuntimeFactory } from '../runtime/runtime-factory.js';
import type { AppServerPtyFactory } from './app-server/command-exec.js';
import type { DesktopNativeBridge } from '../ports/secret-store.js';

export type RuntimeServerOptions = {
  dataDir: string;
  token: string;
  version: string;
  builtinSkillsDir?: string;
  builtinPluginsDir?: string;
  commandExecPtyFactory?: AppServerPtyFactory;
  nativeBridge?: DesktopNativeBridge;
};

export type RuntimeServer = {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  address(): string | AddressInfo | null;
};

export type RuntimeFactory = ReturnType<typeof createRuntimeFactory>;
