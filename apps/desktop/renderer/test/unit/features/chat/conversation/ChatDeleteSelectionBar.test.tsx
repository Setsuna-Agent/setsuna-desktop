// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeleteSelectionBar } from '../../../../../src/features/chat/conversation/ChatDeleteSelectionBar.js';

afterEach(cleanup);

it('cancels selection on Escape while respecting IME, nested controls, other panels and pending deletion', () => {
  const onCancel = vi.fn();
  const contents = (loading = false) => <main><DeleteSelectionBar allChecked={false} disabled={false}
    indeterminate={false} loading={loading} onCancel={onCancel} onConfirm={vi.fn()} onToggleAll={vi.fn()}
    selectedCount={1} totalCount={2} /></main>;
  const view = render(contents());
  fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
  const nested = document.createElement('div');
  nested.setAttribute('role', 'dialog');
  nested.setAttribute('aria-modal', 'true');
  document.body.append(nested);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  nested.removeAttribute('role');
  fireEvent.keyDown(nested, { key: 'Escape' });
  nested.remove();
  view.rerender(contents(true));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onCancel).not.toHaveBeenCalled();
  view.rerender(contents());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
  view.unmount();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
});
