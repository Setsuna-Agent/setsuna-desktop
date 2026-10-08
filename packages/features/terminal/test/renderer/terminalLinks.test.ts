// @vitest-environment happy-dom

import { Terminal, type ILink } from '@xterm/xterm';
import { afterEach, expect, it, vi } from 'vitest';
import { registerTerminalLinks, terminalLinkAtPoint, terminalWebLinksForLine } from '../../src/renderer/terminalLinks.js';

const terminals: Terminal[] = [];

afterEach(() => {
  terminals.splice(0).forEach((terminal) => {
    terminal.element?.remove();
    terminal.dispose();
  });
  vi.restoreAllMocks();
});

it('targets the clicked URL after wide prompt characters and scrollback, excluding punctuation and blank space', async () => {
  const terminal = createTerminal(80, 3);
  const first = 'http://localhost:5174/a?x=1#top';
  const second = 'https://example.org/docs#install';
  await write(terminal, `old 0\r\nold 1\r\nold 2\r\n输出 ${first}), ${second}!`);
  expect(terminal.buffer.active.viewportY).toBe(1);
  expect(terminalWebLinksForLine(terminal, 4).map((link) => link.url)).toEqual([first, second]);

  const point = (column: number) => ({ clientX: 10 + (column - 0.5) * 8, clientY: 20 + 2.5 * 18 });
  expect(terminalLinkAtPoint(terminal, point(6))).toBe(first);
  expect(terminalLinkAtPoint(terminal, point(6 + first.length + 3))).toBe(second);
  expect(terminalLinkAtPoint(terminal, point(6 + first.length))).toBeNull();
  expect(terminalLinkAtPoint(terminal, point(1))).toBeNull();
  expect(terminalLinkAtPoint(terminal, { clientX: 9, clientY: 20 })).toBeNull();
});

it('keeps the whole destination when a URL wraps across terminal rows', async () => {
  const terminal = createTerminal(24, 3);
  const url = 'https://example.org/path?query=value#fragment';
  await write(terminal, `界 ${url}.`);
  const links = terminalWebLinksForLine(terminal, 2);
  expect(links.map((link) => link.url)).toEqual([url]);
  expect(links[0].range).toEqual({ start: { x: 4, y: 1 }, end: { x: 24, y: 2 } });
  expect(terminalLinkAtPoint(terminal, { clientX: 10 + 5.5 * 8, clientY: 20 + 1.5 * 18 })).toBe(url);
  expect(terminalLinkAtPoint(terminal, { clientX: 14, clientY: 20 + 2.5 * 18 })).toBeNull();
});

it('separates right clicks from navigation, handles OSC 8 destinations and releases context listeners', async () => {
  const terminal = createTerminal(80, 3);
  const url = 'https://example.com/path?q=1#anchor';
  await write(terminal, `Visit ${url}`);
  const openLink = vi.fn();
  const openMenu = vi.fn();
  const providerRegistration = vi.spyOn(terminal, 'registerLinkProvider');
  const dispose = registerTerminalLinks(terminal, openLink, openMenu);
  const provider = providerRegistration.mock.calls[0][0];
  let links: ILink[] = [];
  provider.provideLinks(1, (result) => { links = result ?? []; });

  links[0].activate(new MouseEvent('mouseup', { button: 2 }), links[0].text);
  const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  links[0].activate(new MouseEvent('mouseup', { button: 0, ctrlKey: true }), links[0].text);
  platform.mockRestore();
  expect(openLink).not.toHaveBeenCalled();
  const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 70, clientY: 29 });
  terminal.element!.dispatchEvent(contextEvent);
  expect(contextEvent.defaultPrevented).toBe(true);
  expect(openMenu).toHaveBeenCalledExactlyOnceWith({ url, x: 70, y: 29 });
  expect(openLink).not.toHaveBeenCalled();
  links[0].activate(new MouseEvent('mouseup', { button: 0 }), links[0].text);
  expect(openLink).toHaveBeenCalledExactlyOnceWith(url);

  const oscHandler = terminal.options.linkHandler!;
  const range = { start: { x: 1, y: 1 }, end: { x: 5, y: 1 } };
  const oscUrl = 'https://example.net/hidden-target';
  oscHandler.hover!(new MouseEvent('mousemove'), oscUrl, range);
  terminal.element!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 14, clientY: 29 }));
  expect(openMenu).toHaveBeenLastCalledWith({ url: oscUrl, x: 14, y: 29 });
  oscHandler.activate(new MouseEvent('mouseup', { button: 0 }), oscUrl, range);
  expect(openLink).toHaveBeenLastCalledWith(oscUrl);
  oscHandler.activate(new MouseEvent('mouseup', { button: 0 }), 'javascript:alert(1)', range);
  expect(openLink).toHaveBeenCalledTimes(2);
  oscHandler.leave!(new MouseEvent('mouseleave'), oscUrl, range);
  expect(terminalLinkAtPoint(terminal, { clientX: 14, clientY: 29 })).toBeNull();

  dispose();
  terminal.element!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 70, clientY: 29 }));
  expect(openMenu).toHaveBeenCalledTimes(2);
  expect(terminal.options.linkHandler).toBeFalsy();
});

function createTerminal(cols: number, rows: number): Terminal {
  const terminal = new Terminal({ cols, rows });
  terminals.push(terminal);
  const element = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  screen.getBoundingClientRect = () => new DOMRect(10, 20, terminal.cols * 8, terminal.rows * 18);
  element.append(screen);
  document.body.append(element);
  Object.defineProperty(terminal, 'element', { value: element });
  return terminal;
}

function write(terminal: Terminal, text: string): Promise<void> {
  return new Promise((resolve) => terminal.write(text, resolve));
}
