import type { AddressInfo } from 'node:net';
import type { createRuntimeFactory } from '../runtime/runtime-factory.js';
import type { AppServerPtyFactory } from './app-server/command-exec.js';

export type RuntimeServerOptions = {
  dataDir: string;
  token: string;
  version: string;
  builtinSkillsDir?: string;
  commandExecPtyFactory?: AppServerPtyFactory;
};

export type RuntimeServer = {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  address(): string | AddressInfo | null;
};

export type RuntimeFactory = ReturnType<typeof createRuntimeFactory>;
