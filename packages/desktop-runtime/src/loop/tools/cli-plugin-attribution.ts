import type { RuntimePluginReference, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { shellCommandExecutables } from './shell-command-executables.js';

export function isCliCommandTool(name: string): boolean {
  return name === 'run_shell_command' || name === 'exec_command';
}

/** Installed connector ownership is display metadata, never execution authority. */
export class CliPluginAttribution {
  private readonly owners = new Map<string, RuntimePluginReference | null>();

  constructor(plugins: RuntimePluginSummary[], private readonly platform: NodeJS.Platform = process.platform) {
    for (const plugin of plugins) {
      for (const connector of plugin.connectors ?? []) {
        if (connector.kind !== 'cli') continue;
        const executable = this.executableName(connector.command);
        const owner = this.owners.get(executable);
        if (owner === null || (owner && owner.id !== plugin.id)) {
          this.owners.set(executable, null);
        } else {
          this.owners.set(executable, { id: plugin.id, name: plugin.name, ...(plugin.icon ? { icon: plugin.icon } : {}) });
        }
      }
    }
  }

  resolve(toolName: string, input: unknown): RuntimePluginReference | undefined {
    if (!this.owners.size || !isCliCommandTool(toolName) || !input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const args = input as Record<string, unknown>;
    const command = args.command ?? args.cmd;
    if (typeof command !== 'string') return undefined;
    const owners = new Map<string, RuntimePluginReference>();
    for (const executable of shellCommandExecutables(command, this.platform === 'win32' ? 'cmd' : 'posix')) {
      const owner = this.owners.get(this.executableName(executable));
      // The event has one owner: don't guess when a command or script has several.
      if (owner === null) return undefined;
      if (owner) owners.set(owner.id, owner);
    }
    return owners.size === 1 ? owners.values().next().value : undefined;
  }

  private executableName(value: string): string {
    const name = value.split(this.platform === 'win32' ? /[/\\]/u : '/').at(-1) ?? value;
    return this.platform === 'win32' ? name.toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/u, '') : name;
  }
}
