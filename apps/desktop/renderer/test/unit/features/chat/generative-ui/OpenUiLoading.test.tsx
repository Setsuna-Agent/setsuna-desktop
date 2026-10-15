// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../../../../../src/features/chat/markdown/MarkdownRenderer.js';

const loading = vi.hoisted(() => {
  let reject!: (error: Error) => void;
  const ready = new Promise<never>((_resolve, onReject) => { reject = onReject; });
  return { ready, reject, requested: vi.fn() };
});
vi.mock('../../../../../src/features/chat/generative-ui/OpenUiRenderer.js', async () => {
  loading.requested();
  return loading.ready;
});
vi.mock('../../../../../src/features/chat/markdown/MarkdownCodeBlock.js', () => ({
  MarkdownCodeBlock: ({ code }: { code: string }) => <pre data-testid="source-fallback">{code}</pre>,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('ordinary chat does not load OpenUI, and slow or failed loading does not block adjacent text', async () => {
  const view = render(<MarkdownRenderer allowOpenUi content="Ordinary reply" streaming={false} />);
  expect(loading.requested).not.toHaveBeenCalled();
  const code = 'root = Stack([TextContent("Hello")])';
  view.rerender(<MarkdownRenderer allowOpenUi content={['Before', '```openui', code, '```', 'After'].join('\n\n')} streaming={false} />);
  expect(view.getByText('Before')).toBeTruthy();
  expect(view.getByText('After')).toBeTruthy();
  // React reports caught boundary errors to the console in development.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => { loading.reject(new Error('chunk unavailable')); });
  expect((await view.findByTestId('source-fallback')).textContent).toBe('\n' + code + '\n');
  expect(view.getByText('After')).toBeTruthy();
});
