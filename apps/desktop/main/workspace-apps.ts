import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export type DesktopWorkspaceApp = {
  id: string;
  label: string;
  icon: string;
};

type WorkspaceAppDefinition = DesktopWorkspaceApp & {
  macAppName?: string;
  macPaths?: string[];
  macAlways?: boolean;
  linuxCommands?: string[];
  windowsCommands?: string[];
  windowsAlways?: boolean;
};

type WorkspaceAppOpenInput = {
  workspaceRoot?: string | null;
  appId?: string | null;
  filePath?: string | null;
  line?: number | null;
};

const WORKSPACE_APPS: WorkspaceAppDefinition[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    icon: 'vscode',
    macAppName: 'Visual Studio Code',
    macPaths: ['/Applications/Visual Studio Code.app', '${HOME}/Applications/Visual Studio Code.app'],
    linuxCommands: ['code'],
    windowsCommands: ['code.cmd', 'Code.exe'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    icon: 'cursor',
    macAppName: 'Cursor',
    macPaths: ['/Applications/Cursor.app', '${HOME}/Applications/Cursor.app'],
    linuxCommands: ['cursor'],
    windowsCommands: ['cursor.cmd', 'Cursor.exe'],
  },
  {
    id: 'finder',
    label: 'Finder',
    icon: 'finder',
    macAlways: true,
    windowsAlways: false,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: 'explorer',
    windowsAlways: true,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: 'terminal',
    macAppName: 'Terminal',
    macAlways: true,
    linuxCommands: ['x-terminal-emulator', 'gnome-terminal', 'konsole'],
    windowsCommands: ['wt.exe'],
    windowsAlways: true,
  },
  {
    id: 'intellij-idea',
    label: 'IntelliJ IDEA',
    icon: 'intellij-idea',
    macAppName: 'IntelliJ IDEA',
    macPaths: ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA CE.app', '${HOME}/Applications/IntelliJ IDEA.app'],
    linuxCommands: ['idea', 'idea.sh'],
    windowsCommands: ['idea64.exe', 'idea.bat'],
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    icon: 'pycharm',
    macAppName: 'PyCharm',
    macPaths: ['/Applications/PyCharm.app', '/Applications/PyCharm CE.app', '${HOME}/Applications/PyCharm.app'],
    linuxCommands: ['pycharm', 'pycharm.sh'],
    windowsCommands: ['pycharm64.exe', 'pycharm.bat'],
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    icon: 'webstorm',
    macAppName: 'WebStorm',
    macPaths: ['/Applications/WebStorm.app', '${HOME}/Applications/WebStorm.app'],
    linuxCommands: ['webstorm', 'webstorm.sh'],
    windowsCommands: ['webstorm64.exe', 'webstorm.bat'],
  },
];

export async function listWorkspaceApps(workspaceRoot: string): Promise<DesktopWorkspaceApp[]> {
  await resolveWorkspaceDirectory(workspaceRoot);
  return WORKSPACE_APPS.filter((definition) => workspaceAppIsAvailable(definition)).map(({ id, label, icon }) => ({ id, label, icon }));
}

export async function openWorkspaceApp(input: WorkspaceAppOpenInput): Promise<boolean> {
  const workspaceRoot = await resolveWorkspaceDirectory(String(input.workspaceRoot ?? ''));
  const appId = String(input.appId ?? '').trim();
  const definition = WORKSPACE_APPS.find((app) => app.id === appId);
  if (!definition) throw new Error('应用不存在。');

  const target = await workspaceAppFileTarget(workspaceRoot, input.filePath);
  const spec = workspaceAppLaunchSpec(definition, workspaceRoot, target, input.line ?? undefined);
  spawn(spec.program, spec.args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

async function resolveWorkspaceDirectory(value: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请先选择项目目录。');
  const resolved = await realpath(path.resolve(expandHome(trimmed)));
  const workspaceStat = await stat(resolved);
  if (!workspaceStat.isDirectory()) throw new Error('项目目录不存在。');
  return resolved;
}

async function workspaceAppFileTarget(workspaceRoot: string, filePath?: string | null): Promise<string | null> {
  const trimmed = String(filePath ?? '').trim();
  if (!trimmed) return null;
  const target = await realpath(path.resolve(workspaceRoot, trimmed));
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('只能打开当前工作区内的文件。');
  const targetStat = await stat(target);
  if (!targetStat.isFile()) throw new Error('文件不存在，无法打开。');
  return target;
}

function workspaceAppIsAvailable(definition: WorkspaceAppDefinition): boolean {
  if (process.platform === 'darwin') {
    return Boolean(definition.macAlways || definition.macPaths?.some((item) => existsSync(expandHome(item))));
  }
  if (process.platform === 'win32') {
    return Boolean(definition.windowsAlways || definition.windowsCommands?.some((item) => findCommandInPath(item)));
  }
  if (process.platform === 'linux') {
    return Boolean(definition.linuxCommands?.some((item) => findCommandInPath(item)));
  }
  return false;
}

function workspaceAppLaunchSpec(
  definition: WorkspaceAppDefinition,
  workspaceRoot: string,
  filePath: string | null,
  line?: number,
): { program: string; args: string[] } {
  if (process.platform === 'darwin') {
    return macWorkspaceAppLaunchSpec(definition, workspaceRoot, filePath, line);
  }
  if (process.platform === 'win32') {
    return windowsWorkspaceAppLaunchSpec(definition, workspaceRoot, filePath, line);
  }
  return linuxWorkspaceAppLaunchSpec(definition, workspaceRoot, filePath, line);
}

function macWorkspaceAppLaunchSpec(
  definition: WorkspaceAppDefinition,
  workspaceRoot: string,
  filePath: string | null,
  line?: number,
): { program: string; args: string[] } {
  if (filePath) {
    const scheme = workspaceAppFileUriScheme(definition.id);
    if (scheme) return { program: 'open', args: [workspaceAppFileUri(scheme, filePath, line)] };
    if (definition.id === 'finder') return { program: 'open', args: ['-R', filePath] };
    if (definition.macAppName) return { program: 'open', args: ['-a', definition.macAppName, filePath] };
  }
  if (definition.id === 'finder') return { program: 'open', args: [workspaceRoot] };
  if (!definition.macAppName) throw new Error('当前系统不支持此应用。');
  return { program: 'open', args: ['-a', definition.macAppName, workspaceRoot] };
}

function windowsWorkspaceAppLaunchSpec(
  definition: WorkspaceAppDefinition,
  workspaceRoot: string,
  filePath: string | null,
  line?: number,
): { program: string; args: string[] } {
  if (definition.id === 'explorer') {
    return filePath
      ? { program: 'explorer.exe', args: [`/select,${filePath}`] }
      : { program: 'explorer.exe', args: [workspaceRoot] };
  }
  if (definition.id === 'terminal') {
    const wt = findCommandInPath('wt.exe');
    return wt ? { program: wt, args: ['-d', workspaceRoot] } : { program: 'cmd.exe', args: ['/K', 'cd', '/d', workspaceRoot] };
  }
  const program = definition.windowsCommands?.map(findCommandInPath).find(Boolean);
  if (!program) throw new Error('当前系统不支持此应用。');
  return { program, args: filePath ? workspaceAppFileArgs(definition.id, filePath, line) : [workspaceRoot] };
}

function linuxWorkspaceAppLaunchSpec(
  definition: WorkspaceAppDefinition,
  workspaceRoot: string,
  filePath: string | null,
  line?: number,
): { program: string; args: string[] } {
  const program = definition.linuxCommands?.map(findCommandInPath).find(Boolean);
  if (!program) throw new Error('当前系统不支持此应用。');
  if (definition.id === 'terminal') return { program, args: ['--working-directory', workspaceRoot] };
  return { program, args: filePath ? workspaceAppFileArgs(definition.id, filePath, line) : [workspaceRoot] };
}

function workspaceAppFileArgs(appId: string, filePath: string, line?: number): string[] {
  const lineValue = typeof line === 'number' && line > 0 ? line : undefined;
  if (appId === 'vscode' || appId === 'cursor') return ['-g', lineValue ? `${filePath}:${lineValue}` : filePath];
  if (['intellij-idea', 'pycharm', 'webstorm'].includes(appId) && lineValue) return ['--line', String(lineValue), filePath];
  return [lineValue ? `${filePath}:${lineValue}` : filePath];
}

function workspaceAppFileUriScheme(appId: string): string | null {
  if (appId === 'vscode') return 'vscode';
  if (appId === 'cursor') return 'cursor';
  return null;
}

function workspaceAppFileUri(scheme: string, filePath: string, line?: number): string {
  const suffix = typeof line === 'number' && line > 0 ? `:${line}` : '';
  return `${scheme}://file${percentEncodePath(filePath)}${suffix}`;
}

function percentEncodePath(filePath: string): string {
  return filePath
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        ['-', '_', '.', '~', '/', ':'].includes(char)
      ) {
        return char;
      }
      return encodeURIComponent(char);
    })
    .join('');
}

function findCommandInPath(command: string): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) return null;
  for (const directory of pathValue.split(path.delimiter)) {
    const candidate = path.join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function expandHome(value: string): string {
  return value.replace(/^\$\{HOME\}/, homedir()).replace(/^~(?=$|\/|\\)/, homedir());
}
