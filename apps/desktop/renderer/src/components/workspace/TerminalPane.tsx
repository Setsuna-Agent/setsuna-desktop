import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTermTerminal, type ILink, type ILinkProvider, type ITheme } from '@xterm/xterm';
import { Terminal } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { DesktopTerminalEvent, DesktopTerminalSession } from './model.js';

const terminalRestoreBuffers = new Map<string, string>();
const terminalLastEventSeqs = new Map<string, number>();
const MAX_TERMINAL_RESTORE_BUFFER = 1_000_000;
const TERMINAL_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TERMINAL_URL_TRAILING_PUNCTUATION_PATTERN = /[),.;:!?]+$/;

export function clearTerminalRestoreBuffer(sessionId: string): void {
  terminalRestoreBuffers.delete(sessionId);
  terminalLastEventSeqs.delete(sessionId);
}

function appendTerminalRestoreBuffer(sessionId: string, text: string): void {
  if (!text) return;
  const next = `${terminalRestoreBuffers.get(sessionId) ?? ''}${text}`;
  terminalRestoreBuffers.set(sessionId, next.length > MAX_TERMINAL_RESTORE_BUFFER ? next.slice(-MAX_TERMINAL_RESTORE_BUFFER) : next);
}

export function TerminalPane({ session }: { session: DesktopTerminalSession | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const terminalApi = window.setsunaDesktop?.terminal;
    if (!container || !session || !terminalApi) return undefined;

    const terminal = new XTermTerminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: terminalFontFamily(),
      fontSize: 12.5,
      lineHeight: 1.42,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    const linkProviderDisposable = terminal.registerLinkProvider(createTerminalLinkProvider(terminal));
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitTerminal = () => {
      fitAddon.fit();
      void terminalApi.resize(session.sessionId, terminal.cols, terminal.rows).catch(() => undefined);
    };
    const resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(container);
    fitTerminal();
    terminal.focus();
    const restored = terminalRestoreBuffers.get(session.sessionId);
    if (restored) {
      terminal.write(restored);
    }

    const dataDisposable = terminal.onData((input) => {
      void terminalApi.write(session.sessionId, input).catch((error: unknown) => {
        writeTerminalSystemLine(terminal, error instanceof Error ? error.message : String(error), session.sessionId);
      });
    });

    const handleEvent = (event: DesktopTerminalEvent) => {
      const lastSeq = terminalLastEventSeqs.get(session.sessionId) ?? 0;
      if (event.seq <= lastSeq) return;
      terminalLastEventSeqs.set(session.sessionId, event.seq);
      if (event.event === 'ready') return;
      if (event.event === 'output') {
        const text = String(event.data.text ?? '');
        appendTerminalRestoreBuffer(session.sessionId, text);
        terminal.write(text);
        return;
      }
      if (event.event === 'error') {
        writeTerminalSystemLine(terminal, String(event.data.message ?? '终端错误'), session.sessionId);
        return;
      }
      if (event.event === 'exit') {
        const exitCode = event.data.exitCode ?? event.data.signal ?? 'unknown';
        writeTerminalSystemLine(terminal, `进程已退出：${exitCode}`, session.sessionId);
        return;
      }
      if (event.event === 'closed') writeTerminalSystemLine(terminal, '终端已关闭', session.sessionId);
    };

    const unsubscribe = terminalApi.onEvent(session.sessionId, handleEvent);
    void terminalApi.read(session.sessionId).then((events) => events.forEach(handleEvent)).catch(() => undefined);

    return () => {
      unsubscribe();
      dataDisposable.dispose();
      linkProviderDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [session]);

  if (!session) {
    return (
      <div className="terminal-placeholder">
        <Terminal size={15} />
        <span>终端正在启动...</span>
      </div>
    );
  }

  return (
    <div className="desktop-terminal-xterm">
      <div ref={containerRef} className="desktop-terminal-xterm__frame" />
    </div>
  );
}

const lightTerminalTheme: ITheme = {
  background: '#ffffff',
  foreground: '#171717',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selectionBackground: '#e5e5e5',
  black: '#171717',
  red: '#e5484d',
  green: '#0a7f3f',
  yellow: '#a15c00',
  blue: '#006adc',
  magenta: '#8e4ec6',
  cyan: '#007c89',
  white: '#ededed',
  brightBlack: '#737373',
  brightRed: '#e5484d',
  brightGreen: '#0a7f3f',
  brightYellow: '#a15c00',
  brightBlue: '#3291ff',
  brightMagenta: '#8e4ec6',
  brightCyan: '#007c89',
  brightWhite: '#ffffff',
};

const darkTerminalTheme: ITheme = {
  background: '#000000',
  foreground: '#ededed',
  cursor: '#ffffff',
  cursorAccent: '#000000',
  selectionBackground: '#333333',
  black: '#000000',
  red: '#ff6b6b',
  green: '#3dd68c',
  yellow: '#f5d90a',
  blue: '#3291ff',
  magenta: '#b76eff',
  cyan: '#50e3c2',
  white: '#d4d4d4',
  brightBlack: '#7d7d7d',
  brightRed: '#ff8585',
  brightGreen: '#63e6a5',
  brightYellow: '#ffeb57',
  brightBlue: '#52a8ff',
  brightMagenta: '#c993ff',
  brightCyan: '#7eeed8',
  brightWhite: '#ffffff',
};

function terminalTheme(): ITheme {
  return document.documentElement.dataset.theme === 'dark' ? darkTerminalTheme : lightTerminalTheme;
}

function terminalFontFamily(): string {
  const codeFont = window.getComputedStyle(document.documentElement).getPropertyValue('--app-code-font-family').trim();
  return `"Geist Mono", ${codeFont || 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'}`;
}

function writeTerminalSystemLine(terminal: XTermTerminal, text: string, sessionId?: string) {
  const value = `\r\n${text}\r\n`;
  if (sessionId) appendTerminalRestoreBuffer(sessionId, value);
  terminal.write(value);
}

function normalizeTerminalLink(rawText: string): { text: string; url: string } | null {
  let text = rawText;
  while (TERMINAL_URL_TRAILING_PUNCTUATION_PATTERN.test(text)) {
    text = text.slice(0, -1);
  }
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { text, url: url.href };
  } catch {
    return null;
  }
}

function openExternalTerminalLink(value: string): void {
  const normalized = normalizeTerminalLink(value);
  if (!normalized) return;

  const openExternal = window.setsunaDesktop?.links?.openExternal;
  if (openExternal) {
    void openExternal(normalized.url).catch((error: unknown) => {
      console.error('[TerminalPane] failed to open terminal link', error);
    });
    return;
  }
  window.open(normalized.url, '_blank', 'noopener,noreferrer');
}

function createTerminalLinkProvider(terminal: XTermTerminal): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const lineText = line.translateToString(true);
      TERMINAL_URL_PATTERN.lastIndex = 0;
      const links: ILink[] = [];
      for (const match of lineText.matchAll(TERMINAL_URL_PATTERN)) {
        const rawText = match[0];
        const index = match.index;
        if (index === undefined) continue;
        const normalized = normalizeTerminalLink(rawText);
        if (!normalized) continue;

        links.push({
          range: {
            start: { x: index + 1, y: bufferLineNumber },
            end: { x: index + normalized.text.length + 1, y: bufferLineNumber },
          },
          text: normalized.url,
          decorations: {
            pointerCursor: true,
            underline: true,
          },
          activate(event, text) {
            event.preventDefault();
            event.stopPropagation();
            openExternalTerminalLink(text);
          },
        });
      }
      callback(links.length ? links : undefined);
    },
  };
}
