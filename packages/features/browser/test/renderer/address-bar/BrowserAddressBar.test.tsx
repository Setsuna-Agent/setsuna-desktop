// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAddressBar } from '../../../src/renderer/BrowserAddressBar.js';
import { BROWSER_HISTORY_STORAGE_KEY, readBrowserHistory, writeBrowserHistory } from '../../../src/renderer/browserHistory.js';
import { translateBrowserMessage, type BrowserTranslate } from '../../../src/renderer/messages.js';
import { useBrowserHistory } from '../../../src/renderer/useBrowserHistory.js';

const translate: BrowserTranslate = (key, params) => translateBrowserMessage('en-US', key, params);
const visit = { title: 'Model management', url: 'http://localhost:5173/models', visitedAt: 100 };

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(BROWSER_HISTORY_STORAGE_KEY);
});

describe('BrowserAddressBar', () => {
  it('navigates a keyboard-selected history entry and keeps URL search separate from direct navigation', async () => {
    writeBrowserHistory([visit]);
    const navigate = vi.fn();
    render(<Harness onNavigate={navigate} />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(navigate).toHaveBeenLastCalledWith(visit.url);
    expect(screen.queryByRole('grid')).toBeNull();

    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(navigate).toHaveBeenLastCalledWith('https://www.bing.com/search?q=localhost%3A5173');

    await user.click(input);
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenLastCalledWith('http://localhost:5173');
  });

  it('refreshes history on focus and deletes a suggestion without navigating or losing input focus', async () => {
    const navigate = vi.fn();
    render(<Harness onNavigate={navigate} />);
    // Another mounted browser panel records a visit after this one has mounted.
    writeBrowserHistory([visit]);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.click(screen.getByRole('button', { name: 'Delete recent visit Model management' }));
    expect(readBrowserHistory()).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete recent visit Model management' })).toBeNull();
  });

  it('filters while typing, supports mouse selection, and dismisses on Escape or focus leaving the address bar', async () => {
    writeBrowserHistory([visit]);
    const navigate = vi.fn();
    render(<Harness onNavigate={navigate} />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'management');
    await user.click(screen.getByRole('button', { name: /Model management —/ }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(visit.url);

    await user.click(input);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('grid')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('management');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('grid')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('grid')).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when Enter confirms composition, then searches the committed text', async () => {
    const navigate = vi.fn();
    render(<Harness onNavigate={navigate} />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.click(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '模型' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.submit(input.closest('form')!);
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('https://www.bing.com/search?q=%E6%A8%A1%E5%9E%8B');
  });
});

function Harness({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [value, setValue] = useState('localhost:5173');
  const history = useBrowserHistory();
  return <>
    <BrowserAddressBar externalUrl="http://localhost:5173/" hidden={false} history={history.entries}
      value={value} onChange={setValue} onNavigate={onNavigate} onOpenExternal={() => undefined}
      onRefreshHistory={history.refresh} onRemoveHistory={history.removeEntry} translate={translate} />
    <button type="button">Outside</button>
  </>;
}
