import { Button, PointMenu, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTermTerminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { SquareTerminal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DesktopTerminalEvent,
  DesktopTerminalSession,
  TerminalDesktopBridge,
} from '../contracts/index.js';
import {
  markTerminalSessionExited,
  terminalRestoreBuffer,
  terminalSessionExited,
} from './terminalRestoreBuffer.js';
import { subscribeTerminalEvents } from './terminalEventSubscription.js';
import { createTerminalOutput, type TerminalOutput } from './terminalOutput.js';
import { terminalDisplayTitle } from './terminalTitle.js';
import { registerTerminalLinks, type TerminalLinkContextTarget } from './terminalLinks.js';
import './terminal.css';

export type TerminalPaneProps = Readonly<{
  bridge: TerminalDesktopBridge | null;
  session: DesktopTerminalSession | null;
  translate: RendererTranslate;
  onTitleChange?: (title: string) => void;
  openLink: (url: string) => void | Promise<unknown>;
  linkMenuItems: (url: string) => MenuItem[];
  subscribeAppearanceChange?: (listener: () => void) => () => void;
}>;

export function TerminalPane({
  bridge,
  session,
  translate,
  onTitleChange,
  openLink,
  linkMenuItems,
  subscribeAppearanceChange,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const [exited, setExited] = useState(() => Boolean(session && terminalSessionExited(session.sessionId)));
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [linkContextTarget, setLinkContextTarget] = useState<TerminalLinkContextTarget | null>(null);
  const closeLinkContextMenu = useCallback(() => setLinkContextTarget(null), []);
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  // A preference change updates routing without disposing the live terminal.
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session || !bridge) return undefined;
    setExited(terminalSessionExited(session.sessionId));
    setRestartError(null);
    setLinkContextTarget(null);

    const restored = terminalRestoreBuffer(session.sessionId);
    const initialGrid = restored?.initialGrid ?? session;
    const terminal = new XTermTerminal({
      allowProposedApi: false,
      cols: initialGrid.cols,
      convertEol: true,
      cursorBlink: true,
      fontFamily: terminalFontFamily(),
      fontSize: terminalFontSize(),
      lineHeight: 1.42,
      rows: initialGrid.rows,
      scrollback: 5_000,
      theme: terminalTheme(),
      windowsPty: session.windowsPty,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    const output = createTerminalOutput(terminal, session.sessionId, restored);
    const unregisterLinks = registerTerminalLinks(
      terminal,
      (url) => openLinkRef.current(url),
      setLinkContextTarget,
    );
    const titleDisposable = terminal.onTitleChange((title) => {
      onTitleChangeRef.current?.(terminalDisplayTitle(title, session.shell));
    });
    terminalRef.current = terminal;
    onTitleChangeRef.current?.(terminalDisplayTitle('', session.shell));
    let sessionActive = true;
    let outputRestored = false;
    let attached = false;
    let attaching = false;

    const fitTerminal = () => {
      if (!sessionActive || !outputRestored) return;
      output.afterPendingOutput(() => {
        if (!sessionActive || attaching || container.clientWidth === 0 || container.clientHeight === 0) return;
        fitAddon.fit();
        if (!attached) {
          attaching = true;
          void bridge.attach(session.sessionId, terminal.cols, terminal.rows).then((started) => {
            if (!sessionActive) return;
            attached = started;
            attaching = false;
            if (started) fitTerminal();
          }).catch((error: unknown) => {
            if (!sessionActive) return;
            attaching = false;
            markTerminalSessionExited(session.sessionId, true);
            setExited(true);
            setRestartError(errorMessage(error));
          });
          return;
        }
        void bridge.resize(session.sessionId, terminal.cols, terminal.rows).catch(() => undefined);
      });
    };
    const handleAppearanceChange = () => {
      terminal.options.theme = terminalTheme();
      terminal.options.fontFamily = terminalFontFamily();
      terminal.options.fontSize = terminalFontSize();
      fitTerminal();
    };
    const resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(container);
    // Theme and page scale can change without unmounting or resizing the pane.
    const appearanceObserver = new MutationObserver(handleAppearanceChange);
    appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size', 'data-theme'] });
    const unsubscribeAppearance = subscribeAppearanceChange?.(handleAppearanceChange) ?? (() => undefined);
    terminal.focus();

    const dataDisposable = terminal.onData((input) => {
      // Parsed history has already replied; the restored unparsed tail has not.
      if (!sessionActive || output.replaying) return;
      void bridge.write(session.sessionId, input).catch((error: unknown) => {
        writeTerminalSystemLine(output, errorMessage(error));
      });
    });

    const handleEvent = (event: DesktopTerminalEvent) => {
      if (event.event === 'ready') {
        output.resize({ cols: Number(event.data.cols), rows: Number(event.data.rows) });
        attached = true;
        markTerminalSessionExited(session.sessionId, false);
        setExited(false);
        setRestarting(false);
        return;
      }
      if (event.event === 'output') {
        const text = String(event.data.text ?? '');
        output.write(text);
        return;
      }
      if (event.event === 'error') {
        writeTerminalSystemLine(
          output,
          String(event.data.message ?? translate('feature.terminal.error')),
        );
        return;
      }
      if (event.event === 'exit') {
        const exitCode = event.data.exitCode ?? event.data.signal ?? 'unknown';
        writeTerminalSystemLine(
          output,
          translate('feature.terminal.exited', { code: String(exitCode) }),
        );
        markTerminalSessionExited(session.sessionId, true);
        setExited(true);
        return;
      }
      if (event.event === 'closed') {
        sessionActive = false;
        writeTerminalSystemLine(output, translate('feature.terminal.closed'));
      }
    };

    const unsubscribe = subscribeTerminalEvents(bridge, session.sessionId, handleEvent, () => {
      // ConPTY output contains absolute cursor positions for its original grid.
      // Drain the replay before resizing either side, or early repaint/erase
      // sequences can land on the prompt after being clamped to a smaller grid.
      output.afterPendingOutput(() => {
        outputRestored = true;
        fitTerminal();
      });
    });

    return () => {
      sessionActive = false;
      unsubscribe();
      unsubscribeAppearance();
      dataDisposable.dispose();
      unregisterLinks();
      titleDisposable.dispose();
      resizeObserver.disconnect();
      appearanceObserver.disconnect();
      output.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [bridge, session, subscribeAppearanceChange, translate]);

  const restartTerminal = async () => {
    if (!session || !bridge || restarting) return;
    setRestarting(true);
    setRestartError(null);
    try {
      const terminal = terminalRef.current;
      const restarted = await bridge.restart(session.sessionId, terminal?.cols, terminal?.rows);
      if (!restarted) throw new Error(translate('feature.terminal.restartBlocked'));
      terminal?.focus();
    } catch (error) {
      setRestarting(false);
      setRestartError(errorMessage(error));
    }
  };

  if (!session || !bridge) {
    return (
      <div data-feature-id="terminal" className="feature-terminal__placeholder">
        <SquareTerminal size={15} />
        <span>{translate(bridge ? 'feature.terminal.starting' : 'feature.terminal.unavailable')}</span>
      </div>
    );
  }

  return (
    <div data-feature-id="terminal" className="feature-terminal">
      <div ref={containerRef} className="feature-terminal__frame" />
      {linkContextTarget ? (
        <PointMenu
          key={`${linkContextTarget.x}:${linkContextTarget.y}:${linkContextTarget.url}`}
          x={linkContextTarget.x}
          y={linkContextTarget.y}
          menu={{ items: linkMenuItems(linkContextTarget.url) }}
          onClose={closeLinkContextMenu}
        />
      ) : null}
      {exited ? (
        <div className="feature-terminal__restart" role="status">
          <span>{restartError ?? translate('feature.terminal.shellExited')}</span>
          <Button variant="ghost" type="button" disabled={restarting} onClick={() => void restartTerminal()}>
            {translate(restarting ? 'feature.terminal.restarting' : 'feature.terminal.restart')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const lightTerminalTheme: ITheme = {
  background: '#ffffff', foreground: '#171717', cursor: '#000000', cursorAccent: '#ffffff',
  selectionBackground: '#e5e5e5', black: '#171717', red: '#e5484d', green: '#0a7f3f',
  yellow: '#a15c00', blue: '#006adc', magenta: '#8e4ec6', cyan: '#007c89', white: '#ededed',
  brightBlack: '#737373', brightRed: '#e5484d', brightGreen: '#0a7f3f', brightYellow: '#a15c00',
  brightBlue: '#3291ff', brightMagenta: '#8e4ec6', brightCyan: '#007c89', brightWhite: '#ffffff',
};

const darkTerminalTheme: ITheme = {
  background: '#000000', foreground: '#ededed', cursor: '#ffffff', cursorAccent: '#000000',
  selectionBackground: '#333333', black: '#000000', red: '#ff6b6b', green: '#3dd68c',
  yellow: '#f5d90a', blue: '#3291ff', magenta: '#b76eff', cyan: '#50e3c2', white: '#d4d4d4',
  brightBlack: '#7d7d7d', brightRed: '#ff8585', brightGreen: '#63e6a5', brightYellow: '#ffeb57',
  brightBlue: '#52a8ff', brightMagenta: '#c993ff', brightCyan: '#7eeed8', brightWhite: '#ffffff',
};

function terminalTheme(): ITheme {
  return document.documentElement.dataset.theme === 'dark' ? darkTerminalTheme : lightTerminalTheme;
}

function terminalFontFamily(): string {
  const codeFont = window.getComputedStyle(document.documentElement)
    .getPropertyValue('--app-code-font-family')
    .trim();
  return codeFont || 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
}

function terminalFontSize(): number {
  const pageScale = Number.parseFloat(window.getComputedStyle(document.documentElement)
    .getPropertyValue('--app-page-scale'));
  // The frame cancels CSS zoom so xterm's cell metrics match mouse coordinates.
  // Apply the user's scale through xterm itself to keep text at the intended size.
  return 12.5 * (Number.isFinite(pageScale) && pageScale > 0 ? pageScale : 1);
}

function writeTerminalSystemLine(output: TerminalOutput, text: string): void {
  output.write(`\r\n${text}\r\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
