// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopTerminalEvent, DesktopTerminalSession, TerminalDesktopBridge } from '../../src/contracts/index.js';
import { TerminalPane, type TerminalPaneProps } from '../../src/renderer/TerminalPane.js';
import { clearTerminalRestoreBuffer } from '../../src/renderer/terminalRestoreBuffer.js';

const terminalState = vi.hoisted(() => ({
  terminals: [] as Terminal[],
  cols: 80,
  rows: 6,
  resizeListeners: new Set<() => void>(),
}));

// Exercise the real ANSI parser, buffer and protocol replies without a browser
// surface. Only opening/focusing the DOM surface and measuring it are replaced.
vi.mock('@xterm/xterm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xterm/xterm')>();
  return {
    ...actual,
    Terminal: class extends actual.Terminal {
      constructor(options: ConstructorParameters<typeof actual.Terminal>[0]) {
        super({ ...options, allowProposedApi: true });
        terminalState.terminals.push(this);
      }

      open(container: HTMLElement) {
        const element = document.createElement('div');
        const screen = document.createElement('div');
        screen.className = 'xterm-screen';
        screen.getBoundingClientRect = () => new DOMRect(0, 0, this.cols * 8, this.rows * 18);
        element.append(screen);
        container.append(element);
        Object.defineProperty(this, 'element', { value: element });
      }
      focus() {}
    },
  };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    terminal?: Terminal;
    activate(terminal: Terminal) { this.terminal = terminal; }
    fit() { this.terminal?.resize(terminalState.cols, terminalState.rows); }
    dispose() {}
  },
}));

const session: DesktopTerminalSession = {
  sessionId: 'terminal-windows-startup',
  workspaceRoot: 'C:\\workspace',
  shell: 'cmd.exe',
  cols: 100,
  rows: 24,
  windowsPty: { backend: 'conpty', buildNumber: 22631 },
};

const linkProps: Pick<TerminalPaneProps, 'openLink' | 'linkMenuItems'> = {
  openLink: () => undefined,
  linkMenuItems: () => [],
};

beforeEach(() => {
  terminalState.cols = 80;
  terminalState.rows = 6;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: () => void) {}
    observe() { terminalState.resizeListeners.add(this.callback); }
    disconnect() { terminalState.resizeListeners.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
});

afterEach(() => {
  cleanup();
  clearTerminalRestoreBuffer(session.sessionId);
  terminalState.terminals.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('terminal startup protocol', () => {
  it.each(['first query', 'in-flight', 'queued', 'split escape'] as const)('answers an unparsed %s query once across interrupted remounts', async (pending) => {
    const bridge = createBridge(Promise.resolve([]));
    const props = { ...linkProps, bridge, session, translate: (key: string) => key };
    const view = render(<TerminalPane {...props} />);
    await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, 80, 6));
    const historyReplies = pending === 'first query' ? [] : [[session.sessionId, '\u001b[2;3R']];
    if (historyReplies.length) {
      bridge.emit({ seq: 1, event: 'output', data: {
        text: '\u001b[2;3H\u001b[6n' + (pending === 'split escape' ? '\u001b[4;' : ''),
      } });
      await waitFor(() => expect(bridge.write.mock.calls).toEqual(historyReplies));
    }

    // Unmount before xterm's scheduled parser consumes the write or the next
    // queued chunk. The IPC sequence is acknowledged, but its reply is still due.
    if (pending === 'queued') bridge.emit({ seq: 2, event: 'output', data: { text: 'pending text' } });
    bridge.emit({ seq: 3, event: 'output', data: {
      text: pending === 'split escape' ? '5H\u001b[6n' : '\u001b[4;5H\u001b[6n',
    } });
    view.unmount();
    expect(bridge.write.mock.calls).toEqual(historyReplies);

    // Interrupt replay itself as well: pending bytes must survive another switch.
    render(<TerminalPane {...props} />).unmount();
    bridge.resize.mockClear();
    const restored = render(<TerminalPane {...props} />);
    await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, 80, 6));
    expect(bridge.write.mock.calls).toEqual([
      ...historyReplies,
      [session.sessionId, '\u001b[4;5R'],
    ]);

    restored.unmount();
    bridge.resize.mockClear();
    render(<TerminalPane {...props} />);
    await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, 80, 6));
    expect(bridge.write).toHaveBeenCalledTimes(historyReplies.length + 1);
  });

  it.each([false, true])('preserves scrollback across remount after clear-screen and resize (resize=%s)', async (resize) => {
    const bridge = createBridge(Promise.resolve([]));
    const props = { ...linkProps, bridge, session, translate: (key: string) => key };
    const view = render(<TerminalPane {...props} />);
    await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, 80, 6));
    bridge.emit({ seq: 1, event: 'ready', data: { cols: 80, rows: 6 } });
    bridge.emit({ seq: 2, event: 'output', data: {
      text: Array.from({ length: 10 }, (_, i) => `line ${i}\r\n`).join('') + '\u001b[2J\u001b[Hprompt> \u001b[6n',
    } });
    const first = terminalState.terminals[0];
    await waitFor(() => expect(first.buffer.active.baseY).toBe(5));
    expect(bufferText(first).slice(0, 5)).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);

    if (resize) {
      terminalState.cols = 24;
      terminalState.rows = 4;
      act(() => terminalState.resizeListeners.forEach((listener) => listener()));
      await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, 24, 4));
      bridge.emit({ seq: 3, event: 'output', data: { text: 'x'.repeat(120) + '\r\n\u001b[2J\u001b[Hafter resize> ' } });
      await waitFor(() => expect(bufferText(first).join('\n')).toContain('after resize>'));
    }
    const expected = bufferText(first);
    view.unmount();
    bridge.resize.mockClear();
    render(<TerminalPane {...props} />);
    await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, terminalState.cols, terminalState.rows));

    expect(bufferText(terminalState.terminals[1])).toEqual(expected);
    expect(bridge.write.mock.calls).toEqual([[session.sessionId, '\u001b[1;9R']]);
  });

  it('attaches at the fitted size only after subscribing, and forwards startup replies without Enter', async () => {
    const snapshot = deferred<DesktopTerminalEvent[]>();
    const bridge = createBridge(snapshot.promise);
    bridge.attach.mockImplementation(async (_sessionId, cols, rows) => {
      expect(bridge.onEvent).toHaveBeenCalledOnce();
      bridge.emit({ seq: 1, event: 'ready', data: { cols, rows } });
      bridge.emit({ seq: 2, event: 'output', data: { text: '\u001b[2;1HC:\\workspace> \u001b[6n' } });
      return true;
    });
    render(<TerminalPane {...linkProps} bridge={bridge} session={session} translate={(key) => key} />);
    expect(bridge.attach).not.toHaveBeenCalled();

    await act(async () => {
      snapshot.resolve([]);
      await snapshot.promise;
    });

    await waitFor(() => expect(bridge.write).toHaveBeenCalledWith(session.sessionId, '\u001b[2;15R'));
    expect(bridge.attach).toHaveBeenCalledExactlyOnceWith(session.sessionId, 80, 6);
    expect(bridge.write.mock.calls).toEqual([[session.sessionId, '\u001b[2;15R']]);
    expect(terminalState.terminals[0].buffer.active.getLine(1)?.translateToString(true)).toContain('C:\\workspace>');
  });

  it('retains the Windows prompt and answers cursor queries before fitting a smaller pane', async () => {
    const snapshot = deferred<DesktopTerminalEvent[]>();
    const bridge = createBridge(snapshot.promise);
    render(<TerminalPane {...linkProps} bridge={bridge} session={session} translate={(key) => key} />);

    expect(bridge.resize).not.toHaveBeenCalled();
    await act(async () => {
      snapshot.resolve([
        { seq: 1, event: 'ready', data: { cols: 100, rows: 24 } },
        // Absolute repaint/erase positions must be interpreted on the original
        // PTY grid. On a six-row grid these two rows collapse and erase the prompt.
        { seq: 2, event: 'output', data: { text: '\u001b[20;1HC:\\workspace> \u001b[19;1H\u001b[2K\u001b[20;15H\u001b[6n' } },
      ]);
      await snapshot.promise;
    });

    await waitFor(() => expect(bridge.resize).toHaveBeenCalledWith(session.sessionId, 80, 6));
    const terminal = terminalState.terminals[0];
    const buffer = terminal.buffer.active;
    const visibleText = Array.from({ length: terminal.rows }, (_, row) => (
      buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
    )).join('\n');
    expect(visibleText).toContain('C:\\workspace>');
    expect(bridge.write.mock.calls).toEqual([[session.sessionId, '\u001b[20;15R']]);
    expect(terminal.options.windowsPty).toEqual(session.windowsPty);
  });

  it('does not resize or send protocol replies after closing during the history read', async () => {
    const snapshot = deferred<DesktopTerminalEvent[]>();
    const bridge = createBridge(snapshot.promise);
    const view = render(<TerminalPane {...linkProps} bridge={bridge} session={session} translate={(key) => key} />);
    view.unmount();

    snapshot.resolve([{ seq: 1, event: 'output', data: { text: '\u001b[6n' } }]);
    await snapshot.promise;

    expect(bridge.resize).not.toHaveBeenCalled();
    expect(bridge.attach).not.toHaveBeenCalled();
    expect(bridge.write).not.toHaveBeenCalled();
  });
});

it('uses updated link routing without replaying the terminal, and selects or dismisses a menu without navigating', async () => {
  const bridge = createBridge(Promise.resolve([]));
  const openInApp = vi.fn();
  const openExternal = vi.fn();
  const copyLink = vi.fn();
  const url = 'https://example.com/path?q=1#anchor';
  const props: TerminalPaneProps = {
    bridge, session, translate: (key) => key, openLink: openInApp,
    linkMenuItems: (href) => [{ key: 'copy-link', label: 'Copy link', onClick: () => copyLink(href) }],
  };
  const view = render(<TerminalPane {...props} />);
  await waitFor(() => expect(bridge.attach).toHaveBeenCalledOnce());
  act(() => bridge.emit({ seq: 1, event: 'output', data: { text: `Visit ${url}` } }));
  const terminal = terminalState.terminals[0];
  await waitFor(() => expect(bufferText(terminal)[0]).toBe(`Visit ${url}`));
  const range = { start: { x: 7, y: 1 }, end: { x: 39, y: 1 } };
  terminal.options.linkHandler!.activate(new MouseEvent('mouseup', { button: 0 }), url, range);
  expect(openInApp).toHaveBeenCalledExactlyOnceWith(url);

  view.rerender(<TerminalPane {...props} openLink={openExternal} />);
  terminal.options.linkHandler!.activate(new MouseEvent('mouseup', { button: 0 }), url, range);
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
  expect(terminalState.terminals).toHaveLength(1);
  expect(bridge.attach).toHaveBeenCalledOnce();
  expect(bridge.read).toHaveBeenCalledOnce();
  expect(bufferText(terminal)[0]).toBe(`Visit ${url}`);

  fireEvent.contextMenu(terminal.element!, { clientX: 60, clientY: 9 });
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Copy link' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(copyLink).not.toHaveBeenCalled();
  fireEvent.contextMenu(terminal.element!, { clientX: 60, clientY: 9 });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
  expect(copyLink).toHaveBeenCalledExactlyOnceWith(url);
  expect(openInApp).toHaveBeenCalledOnce();
  expect(openExternal).toHaveBeenCalledOnce();
});

function bufferText(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '');
}

function createBridge(history: Promise<DesktopTerminalEvent[]>) {
  let listener: ((event: DesktopTerminalEvent) => void) | undefined;
  return {
    open: vi.fn<TerminalDesktopBridge['open']>(),
    attach: vi.fn<TerminalDesktopBridge['attach']>().mockResolvedValue(true),
    write: vi.fn<TerminalDesktopBridge['write']>().mockResolvedValue(true),
    read: vi.fn<TerminalDesktopBridge['read']>().mockReturnValue(history),
    resize: vi.fn<TerminalDesktopBridge['resize']>().mockResolvedValue(true),
    restart: vi.fn<TerminalDesktopBridge['restart']>(),
    close: vi.fn<TerminalDesktopBridge['close']>(),
    onEvent: vi.fn<TerminalDesktopBridge['onEvent']>().mockImplementation((_sessionId, callback) => {
      listener = callback;
      return () => { listener = undefined; };
    }),
    emit: (event: DesktopTerminalEvent) => listener?.(event),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
