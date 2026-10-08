import type { IBufferCellPosition, IBufferRange, ILinkHandler, Terminal } from '@xterm/xterm';

const TERMINAL_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TERMINAL_URL_TRAILING_PUNCTUATION_PATTERN = /[),.;:!?]+$/;

type TerminalWebLink = Readonly<{ url: string; range: IBufferRange }>;
export type TerminalLinkContextTarget = Readonly<{ url: string; x: number; y: number }>;

export function terminalWebLinksForLine(terminal: Terminal, bufferLineNumber: number): TerminalWebLink[] {
  const buffer = terminal.buffer.active;
  let firstRow = bufferLineNumber - 1;
  if (!buffer.getLine(firstRow)) return [];
  while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) firstRow -= 1;

  let text = '';
  const positions: IBufferCellPosition[] = [];
  const cell = buffer.getNullCell();
  // Match logical lines, but keep a cell position for each UTF-16 character:
  // wrapped URLs and wide prompt characters cannot use string offsets as columns.
  for (let row = firstRow; row < buffer.length; row += 1) {
    const line = buffer.getLine(row);
    if (!line) break;
    for (let column = 0; column < Math.min(line.length, terminal.cols); column += 1) {
      const currentCell = line.getCell(column, cell);
      if (!currentCell || currentCell.getWidth() === 0) continue;
      const chars = currentCell.getChars() || ' ';
      text += chars;
      for (let index = 0; index < chars.length; index += 1) positions.push({ x: column + 1, y: row + 1 });
    }
    if (!buffer.getLine(row + 1)?.isWrapped) break;
  }

  const links: TerminalWebLink[] = [];
  for (const match of text.matchAll(TERMINAL_URL_PATTERN)) {
    const linkText = match[0].replace(TERMINAL_URL_TRAILING_PUNCTUATION_PATTERN, '');
    const url = terminalWebUrl(linkText);
    if (!url || match.index === undefined) continue;
    const start = positions[match.index];
    const end = positions[match.index + linkText.length - 1];
    const endWidth = buffer.getLine(end.y - 1)?.getCell(end.x - 1)?.getWidth() ?? 1;
    links.push({ url, range: { start, end: { x: end.x + endWidth - 1, y: end.y } } });
  }
  return links;
}

export function terminalLinkAtPoint(
  terminal: Terminal,
  point: Pick<MouseEvent, 'clientX' | 'clientY'>,
  hoveredLink?: TerminalWebLink | null,
): string | null {
  const screen = terminal.element?.querySelector('.xterm-screen');
  const rect = screen?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
  const position = {
    x: Math.floor(x / rect.width * terminal.cols) + 1,
    y: Math.floor(y / rect.height * terminal.rows) + terminal.buffer.active.viewportY + 1,
  };
  if (hoveredLink && linkContainsPosition(hoveredLink.range, position, terminal.cols)) return hoveredLink.url;
  return terminalWebLinksForLine(terminal, position.y)
    .find((link) => linkContainsPosition(link.range, position, terminal.cols))?.url ?? null;
}

export function registerTerminalLinks(
  terminal: Terminal,
  openLink: (url: string) => void | Promise<unknown>,
  openContextMenu: (target: TerminalLinkContextTarget) => void,
): () => void {
  const element = terminal.element;
  let hoveredOscLink: TerminalWebLink | null = null;
  const activate = async (event: MouseEvent, text: string) => {
    // xterm activates links on mouseup for every button, including a right click.
    if (event.button !== 0 || (event.ctrlKey && navigator.platform.toLowerCase().includes('mac'))) return;
    const url = terminalWebUrl(text);
    if (!url) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await openLink(url);
    } catch (error: unknown) {
      console.error('[TerminalPane] failed to open terminal link', error);
    }
  };
  const previousLinkHandler = terminal.options.linkHandler;
  const linkHandler: ILinkHandler = {
    activate,
    hover(_event, text, range) {
      const url = terminalWebUrl(text);
      hoveredOscLink = url ? { url, range } : null;
    },
    leave() { hoveredOscLink = null; },
  };
  terminal.options.linkHandler = linkHandler;
  const provider = terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const links = terminalWebLinksForLine(terminal, bufferLineNumber).map(({ url, range }) => ({
        text: url,
        range,
        decorations: { pointerCursor: true, underline: true },
        activate,
      }));
      callback(links.length ? links : undefined);
    },
  });
  const handleContextMenu = (event: MouseEvent) => {
    const url = terminalLinkAtPoint(terminal, event, hoveredOscLink);
    if (!url) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({ url, x: event.clientX, y: event.clientY });
  };
  // Capture before xterm moves its textarea under the pointer for a native menu.
  element?.addEventListener('contextmenu', handleContextMenu, true);
  return () => {
    element?.removeEventListener('contextmenu', handleContextMenu, true);
    provider.dispose();
    terminal.options.linkHandler = previousLinkHandler;
  };
}

function terminalWebUrl(text: string): string | null {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function linkContainsPosition(range: IBufferRange, position: IBufferCellPosition, columns: number): boolean {
  const offset = (cell: IBufferCellPosition) => (cell.y - 1) * columns + cell.x - 1;
  return offset(position) >= offset(range.start) && offset(position) <= offset(range.end);
}
