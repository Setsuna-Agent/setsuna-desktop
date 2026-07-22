import type {
  DesktopTerminalEventPayload,
  DesktopTerminalEvent as DesktopTerminalEventRecord,
  DesktopTerminalSession,
} from '@setsuna-desktop/contracts';
import type { IDisposable, IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { desktopShellPath } from '../runtime/desktop-environment.js';

export type { DesktopTerminalEventPayload as DesktopTerminalEvent } from '@setsuna-desktop/contracts';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');

type TerminalSession = DesktopTerminalSession & {
  cols: number;
  dataDisposable: IDisposable;
  events: DesktopTerminalEventPayload[];
  exited: boolean;
  exitDisposable: IDisposable;
  ptyProcess: IPty | null;
  rows: number;
  seq: number;
  shellArgs: string[];
  shellCommand: string;
};

type TerminalOpenInput = {
  workspaceRoot?: string | null;
  cols?: number;
  rows?: number;
};

const MAX_EVENT_QUEUE = 2000;

export class DesktopTerminalStore {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly publish: (event: DesktopTerminalEventPayload) => void) {}

  async open(input: TerminalOpenInput): Promise<DesktopTerminalSession> {
    const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot);
    const shell = defaultShellSpec();
    const sessionId = `terminal-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const session: TerminalSession = {
      sessionId,
      workspaceRoot,
      shell: shell.displayName,
      cols: terminalDimension(input.cols, 100),
      dataDisposable: { dispose: () => undefined },
      events: [],
      exited: false,
      exitDisposable: { dispose: () => undefined },
      ptyProcess: null,
      rows: terminalDimension(input.rows, 24),
      seq: 0,
      shellArgs: shell.args,
      shellCommand: shell.command,
    };
    this.sessions.set(sessionId, session);
    this.startSessionProcess(session);

    return {
      sessionId,
      workspaceRoot,
      shell: shell.displayName,
    };
  }

  write(sessionId: string, input: string): boolean {
    const session = this.requireSession(sessionId);
    if (!session.ptyProcess || session.exited) throw new Error('终端进程已退出，请重新启动。');
    session.ptyProcess.write(input);
    return true;
  }

  read(sessionId: string): DesktopTerminalEventPayload[] {
    const session = this.requireSession(sessionId);
    return session.events.splice(0, session.events.length);
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.requireSession(sessionId);
    session.cols = terminalDimension(cols, 100);
    session.rows = terminalDimension(rows, 24);
    if (!session.ptyProcess || session.exited) return false;
    session.ptyProcess.resize(session.cols, session.rows);
    return true;
  }

  restart(sessionId: string, cols?: number, rows?: number): boolean {
    const session = this.requireSession(sessionId);
    if (!session.exited) return false;
    session.cols = terminalDimension(cols, session.cols);
    session.rows = terminalDimension(rows, session.rows);
    this.startSessionProcess(session);
    return true;
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    session.dataDisposable.dispose();
    session.exitDisposable.dispose();
    try {
      session.ptyProcess?.kill();
    } catch {
      // 渲染进程关闭恢复的面板时，对应的 PTY 可能已经不存在。
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

  private startSessionProcess(session: TerminalSession): void {
    session.dataDisposable.dispose();
    session.exitDisposable.dispose();
    const ptyProcess = pty.spawn(session.shellCommand, session.shellArgs, {
      cols: session.cols,
      cwd: session.workspaceRoot,
      encoding: 'utf8',
      env: terminalEnvironment(),
      name: 'xterm-256color',
      rows: session.rows,
    });
    session.ptyProcess = ptyProcess;
    session.exited = false;
    session.dataDisposable = ptyProcess.onData((text) => {
      if (session.ptyProcess !== ptyProcess) return;
      this.emit(session.sessionId, 'output', { text });
    });
    session.exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      if (this.sessions.get(session.sessionId) !== session || session.ptyProcess !== ptyProcess) return;
      session.exited = true;
      session.ptyProcess = null;
      this.emit(session.sessionId, 'exit', { exitCode, signal });
    });
    this.emit(session.sessionId, 'ready', {
      shell: session.shell,
      workspaceRoot: session.workspaceRoot,
      cols: session.cols,
      rows: session.rows,
    });
  }

  private emit(sessionId: string, event: DesktopTerminalEventRecord['event'], data: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    const seq = session ? ++session.seq : 0;
    const payload: DesktopTerminalEventPayload = { sessionId, seq, event, data };
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
