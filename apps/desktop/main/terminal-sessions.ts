import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import type { IDisposable, IPty } from 'node-pty';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');

export type DesktopTerminalSession = {
  sessionId: string;
  workspaceRoot: string;
  shell: string;
};

export type DesktopTerminalEvent = {
  sessionId: string;
  seq: number;
  event: 'ready' | 'output' | 'exit' | 'closed' | 'error';
  data: Record<string, unknown>;
};

type TerminalSession = DesktopTerminalSession & {
  dataDisposable: IDisposable;
  events: DesktopTerminalEvent[];
  exitDisposable: IDisposable;
  ptyProcess: IPty;
  seq: number;
};

type TerminalOpenInput = {
  workspaceRoot?: string | null;
  cols?: number;
  rows?: number;
};

const MAX_EVENT_QUEUE = 2000;

export class DesktopTerminalStore {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly publish: (event: DesktopTerminalEvent) => void) {}

  async open(input: TerminalOpenInput): Promise<DesktopTerminalSession> {
    const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot);
    const shell = defaultShellSpec();
    const sessionId = `terminal-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const ptyProcess = pty.spawn(shell.command, shell.args, {
      cols: terminalDimension(input.cols, 100),
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: terminalEnvironment(),
      name: 'xterm-256color',
      rows: terminalDimension(input.rows, 24),
    });
    const session: TerminalSession = {
      sessionId,
      workspaceRoot,
      shell: shell.displayName,
      dataDisposable: { dispose: () => undefined },
      events: [],
      exitDisposable: { dispose: () => undefined },
      ptyProcess,
      seq: 0,
    };
    this.sessions.set(sessionId, session);

    session.dataDisposable = ptyProcess.onData((text) => {
      this.emit(sessionId, 'output', { text });
    });
    session.exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      if (!this.sessions.has(sessionId)) return;
      this.emit(sessionId, 'exit', { exitCode, signal });
      this.sessions.delete(sessionId);
    });

    this.emit(sessionId, 'ready', {
      shell: shell.displayName,
      workspaceRoot,
      cols: input.cols ?? 100,
      rows: input.rows ?? 24,
    });

    return {
      sessionId,
      workspaceRoot,
      shell: shell.displayName,
    };
  }

  write(sessionId: string, input: string): boolean {
    const session = this.requireSession(sessionId);
    session.ptyProcess.write(input);
    return true;
  }

  read(sessionId: string): DesktopTerminalEvent[] {
    const session = this.requireSession(sessionId);
    return session.events.splice(0, session.events.length);
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.requireSession(sessionId);
    session.ptyProcess.resize(terminalDimension(cols, 100), terminalDimension(rows, 24));
    return true;
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    session.dataDisposable.dispose();
    session.exitDisposable.dispose();
    try {
      session.ptyProcess.kill();
    } catch {
      // The PTY can already be gone when the renderer closes a restored panel.
    }
    this.publish({ sessionId, seq: session.seq + 1, event: 'closed', data: {} });
    return true;
  }

  closeAll(): void {
    for (const sessionId of this.sessions.keys()) this.close(sessionId);
  }

  private requireSession(sessionId: string): TerminalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('终端会话不存在或已关闭。');
    return session;
  }

  private emit(sessionId: string, event: DesktopTerminalEvent['event'], data: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    const seq = session ? ++session.seq : 0;
    const payload: DesktopTerminalEvent = { sessionId, seq, event, data };
    if (session) {
      session.events.push(payload);
      if (session.events.length > MAX_EVENT_QUEUE) session.events.splice(0, session.events.length - MAX_EVENT_QUEUE);
    }
    this.publish(payload);
  }
}

async function resolveWorkspaceRoot(workspaceRoot?: string | null): Promise<string> {
  const candidate = workspaceRoot?.trim() || homedir();
  const resolved = await realpath(path.resolve(candidate));
  const targetStat = await stat(resolved);
  if (!targetStat.isDirectory()) throw new Error('终端工作目录必须是文件夹。');
  return resolved;
}

function defaultShellSpec(): { command: string; args: string[]; displayName: string } {
  if (process.platform === 'win32') {
    const command = process.env.ComSpec || 'cmd.exe';
    return { command, args: ['/Q', '/K'], displayName: path.basename(command) };
  }
  const command = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return { command, args: ['-i'], displayName: path.basename(command) };
}

function terminalEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: desktopShellPath(process.env.PATH),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    FORCE_COLOR: '3',
    GIT_PAGER: 'cat',
    LESS: '-FRX',
    PAGER: 'cat',
    PROMPT_EOL_MARK: '',
    npm_config_color: 'always',
  };
  delete env.NO_COLOR;
  delete env.CI;
  return env;
}

function terminalDimension(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(value ?? fallback));
}

function desktopShellPath(basePath = ''): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return [
    ...String(basePath || '').split(path.delimiter),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'Library', 'pnpm'),
  ]
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .join(path.delimiter);
}
