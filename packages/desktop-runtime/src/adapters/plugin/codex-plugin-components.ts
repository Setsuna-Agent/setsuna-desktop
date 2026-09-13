import { readdir } from 'node:fs/promises';
import { bundlePathExists, safeExistingPath } from './file-plugin-bundle-paths.js';

/** Auxiliary host definitions must not prevent importing independent Skills and MCP servers. */
export async function codexUnsupportedComponents(root: string, manifest: Record<string, unknown>): Promise<string[]> {
  if (manifest.extension !== undefined) throw new Error('Codex plugin extension is not supported yet.');
  const unsupported: string[] = [];
  if (manifest.hooks !== undefined || await bundlePathExists(root, 'hooks/hooks.json') || await bundlePathExists(root, 'hooks.json')) {
    unsupported.push('hooks');
  }
  if (manifest.commands !== undefined || await bundlePathExists(root, 'commands')) unsupported.push('commands');
  if (manifest.agents !== undefined) unsupported.push('agents');
  else if (await bundlePathExists(root, 'agents')) {
    const entries = await readdir(await safeExistingPath(root, 'agents'));
    // openai.yaml is presentation metadata, not a custom agent definition.
    if (entries.some((entry) => entry !== 'openai.yaml')) unsupported.push('agents');
  }
  return unsupported;
}
