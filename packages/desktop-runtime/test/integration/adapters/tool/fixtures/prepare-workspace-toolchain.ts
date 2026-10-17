import { readFile, writeFile } from 'node:fs/promises';
import { ManagedWorkspaceDependencyManager } from '../../../../../../features/workspace-dependencies/src/runtime/managed-workspace-dependency-manager.js';
import { DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS } from '../../../../../../features/workspace-dependencies/src/contracts/index.js';

const input = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
const manager = new ManagedWorkspaceDependencyManager(
  input.dataDir,
  async () => DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS,
  async () => true,
);
const toolchain = await manager.prepareShellToolchain({
  command: 'pnpm dev',
  environment: {
    id: 'console-regression', cwd: input.projectDir, workspaceRoot: input.projectDir,
    workspaceRoots: [input.projectDir], shell: process.env.ComSpec || 'cmd.exe',
  },
});
await writeFile(input.output, JSON.stringify({ runtime: process.execPath, toolchain }));
