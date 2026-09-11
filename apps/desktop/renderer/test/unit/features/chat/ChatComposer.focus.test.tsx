// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatComposer } from '../../../../src/features/chat/ChatComposer.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

afterEach(cleanup);

it.each([false, true])('keeps focus across repeated click and keyboard submissions (side conversation: %s)', async (sideConversation) => {
  const pending: Array<(sent: boolean) => void> = [];
  const send = vi.fn(() => new Promise<boolean>((resolve) => pending.push(resolve)));
  render(<Harness send={send} sideConversation={sideConversation} />);
  const input = screen.getByRole('textbox');
  const user = userEvent.setup();

  for (const [index, text] of ['First message', 'Next queued message', 'Retry this draft'].entries()) {
    await user.click(input);
    input.textContent = text;
    fireEvent.input(input);
    if (index === 1) fireEvent.keyDown(input, { key: 'Enter' });
    else await user.click(screen.getByRole('button', { name: index === 0 ? '发送' : '加入发送队列' }));
    expect(send).toHaveBeenCalledTimes(index + 1);
    expect(input.getAttribute('contenteditable')).toBe('false');
    expect(document.activeElement).toBe(input);
    // The lock must also cover custom newline/paste handlers while focus stays here.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.paste(input, { clipboardData: { files: [], getData: () => 'unexpected paste' } });
    expect(input.textContent).toBe(text);
    await act(async () => pending[index](index !== 2));
    expect(input.getAttribute('contenteditable')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(input.textContent).toBe(index === 2 ? text : '');
    expect(input.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
  }
});

it('does not reclaim focus when the user moves elsewhere during submission', async () => {
  let complete!: (sent: boolean) => void;
  render(<Harness send={() => new Promise<boolean>((resolve) => { complete = resolve; })} />);
  const input = screen.getByRole('textbox');
  input.textContent = 'Send and keep reading';
  fireEvent.input(input);
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
  await userEvent.click(elsewhere);
  await act(async () => complete(true));
  expect(document.activeElement).toBe(elsewhere);
});

it('only focuses the side composer on reveal and leaves main focus alone when a hidden send finishes', async () => {
  let complete!: (sent: boolean) => void;
  const send = () => new Promise<boolean>((resolve) => { complete = resolve; });
  const conversations = (visible: boolean) => <>
    <Harness send={async () => true} placeholder="Main conversation" />
    <Harness send={send} sideConversation visible={visible} placeholder="Side conversation" />
  </>;
  const view = render(conversations(true));
  const main = screen.getByRole('textbox', { name: 'Main conversation' });
  const side = screen.getByRole('textbox', { name: 'Side conversation' });
  expect(document.activeElement).toBe(side);
  await userEvent.click(main);
  view.rerender(conversations(true));
  expect(document.activeElement).toBe(main);

  await userEvent.click(side);
  side.textContent = 'Side request';
  fireEvent.input(side);
  fireEvent.keyDown(side, { key: 'Enter' });
  view.rerender(conversations(false));
  await userEvent.click(main);
  await act(async () => complete(true));
  expect(document.activeElement).toBe(main);
  view.rerender(conversations(true));
  expect(document.activeElement).toBe(side);
  expect(side.textContent).toBe('');
});

function Harness({ send, sideConversation = false, visible = true, placeholder }: {
  send: () => Promise<boolean>;
  sideConversation?: boolean;
  visible?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  return <RendererPluginTestHost><section hidden={!visible}>
    <ChatComposer
      activeTurnId={activeTurnId}
      client={{} as DesktopRuntimeClient}
      config={null}
      canClearContext={false}
      contextUsage={{ compactedMessageCount: 0, percent: 0, totalTokens: 256_000, triggerScopes: [], usedTokens: 0, visiblePercent: 0 }}
      currentThread={{ id: 'existing-thread', messages: [], queuedTurnInputs: [] } as unknown as RuntimeThread}
      draft={draft}
      sideConversation={sideConversation}
      focusOnReveal={sideConversation && visible}
      placeholder={placeholder}
      skills={[]}
      onDraftChange={setDraft}
      onSend={async () => {
        const sent = await send();
        if (sent) setActiveTurnId('turn-1');
        return sent;
      }}
      queuedTurnActions={{
        deleteQueuedTurnInput: vi.fn(), releaseQueuedTurnInputEdit: vi.fn(), retrieveQueuedTurnInput: vi.fn(),
        sendQueuedTurnInputNow: vi.fn(), updateQueuedTurnInput: vi.fn(),
      }}
      onAccessModeChange={vi.fn()}
      onCancelActiveTurn={vi.fn()}
      onClearContext={vi.fn()}
      onCompactContext={vi.fn()}
      onSelectModel={vi.fn()}
      onSetMultiAgentEnabled={vi.fn()}
      onStartThreadReview={vi.fn()}
      onSearchProjectEntries={vi.fn()}
    />
    <button type="button">Elsewhere</button>
  </section></RendererPluginTestHost>;
}
