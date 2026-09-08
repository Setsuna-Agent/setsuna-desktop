import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathIsInside } from '../adapters/plugin/file-plugin-bundle-model.js';
import type { InstalledPluginRecord } from '../ports/plugin-bundle-store.js';
import { ExtensionWorkerClient } from './extension-worker-client.js';

type ExtensionActivationValidationOptions = {
  plugin: InstalledPluginRecord;
  workerEntryPath: string;
  workerExecArgv: string[];
};

/**
 * Boots an approved staged worker with a closed host bridge before its bundle
 * replaces the installed version. A failed import or missing registration can
 * therefore never be reported as a successful installation.
 */
export async function validateStagedExtensionActivation(
  options: ExtensionActivationValidationOptions,
): Promise<void> {
  const { plugin } = options;
  const extension = plugin.extension;
  if (!extension) return;

  const pluginRoot = await realpath(plugin.installPath);
  const entryPath = await realpath(path.resolve(pluginRoot, extension.entry));
  if (!pathIsInside(pluginRoot, entryPath)) {
    throw new Error('Extension entry escapes the staged plugin directory.');
  }
  const client = new ExtensionWorkerClient({
    pluginId: plugin.id,
    entryPath,
    pluginRoot,
    capabilities: [...extension.capabilities],
    workerEntryPath: options.workerEntryPath,
    ...(options.workerExecArgv.length ? { execArgv: [...options.workerExecArgv] } : {}),
    onHostRequest: async (method) => {
      throw new Error(`Extension activation cannot call host method ${method}.`);
    },
  });
  try {
    const ready = await client.start();
    assertDeclaredExtensionRegistrations(
      plugin,
      ready.tools.map((tool) => tool.name),
      ready.uiActions,
    );
  } catch (error) {
    throw new Error(`Extension activation validation failed: ${errorMessage(error)}`, { cause: error });
  } finally {
    await client.stop().catch(() => undefined);
  }
}

export function assertDeclaredExtensionRegistrations(
  plugin: InstalledPluginRecord,
  registeredToolNames: string[],
  registeredActionIds: string[],
): void {
  assertExactRegistrationSet(
    'tool',
    (plugin.tools ?? []).map((tool) => tool.name),
    registeredToolNames,
  );
  assertExactRegistrationSet(
    'UI action',
    (plugin.extension?.rendererUi?.actions ?? []).map((action) => action.id),
    registeredActionIds,
  );
}

function assertExactRegistrationSet(
  kind: 'tool' | 'UI action',
  declaredNames: string[],
  registeredNames: string[],
): void {
  const registered = new Set(registeredNames);
  for (const name of declaredNames) {
    if (!registered.has(name)) {
      throw new Error(`Extension did not register declared ${kind}: ${name}.`);
    }
  }
  const declared = new Set(declaredNames);
  for (const name of registeredNames) {
    if (!declared.has(name)) {
      throw new Error(`Extension registered undeclared ${kind}: ${name}.`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
