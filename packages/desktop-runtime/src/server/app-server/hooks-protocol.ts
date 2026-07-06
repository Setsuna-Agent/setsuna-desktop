import type { RuntimeHookListEntry } from '@setsuna-desktop/contracts';
import { discoverRuntimeHooks } from '../../hooks/runtime-hooks.js';
import type { RuntimeFactory } from '../types.js';
import { AppServerRpcError } from './errors.js';
import { recordInput } from './input.js';

export async function appServerHooksListResponse(
  runtime: RuntimeFactory,
  params: unknown,
): Promise<{ data: RuntimeHookListEntry[] }> {
  const input = recordInput(params);
  const cwds = appServerHookCwds(input.cwds);
  const config = await runtime.configStore.getConfig();
  const discovery = discoverRuntimeHooks(config);
  return {
    data: cwds.map((cwd) => ({
      cwd,
      hooks: discovery.hooks.map(({ configEventName: _configEventName, matcherEnabled: _matcherEnabled, ...hook }) => hook),
      warnings: discovery.warnings,
      errors: [],
    })),
  };
}

function appServerHookCwds(value: unknown): string[] {
  if (value === undefined || value === null) return [process.cwd()];
  if (!Array.isArray(value)) throw new AppServerRpcError(-32602, 'cwds must be an array');
  const cwds = value.map((item, index) => {
    if (typeof item !== 'string') throw new AppServerRpcError(-32602, `cwds[${index}] must be a string`);
    return item || process.cwd();
  });
  return cwds.length ? cwds : [process.cwd()];
}
