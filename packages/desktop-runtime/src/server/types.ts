import type { AddressInfo } from 'node:net';
import type { createRuntimeFactory } from '../runtime/runtime-factory.js';

export type RuntimeServerOptions = {
  dataDir: string;
  token: string;
  version: string;
  builtinSkillsDir?: string;
};

export type RuntimeServer = {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  address(): string | AddressInfo | null;
};

export type RuntimeFactory = ReturnType<typeof createRuntimeFactory>;
