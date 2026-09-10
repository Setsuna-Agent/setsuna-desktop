// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { defaultGitSettings } from '../../src/contracts/index.js';
import type { ReviewClient } from '../../src/renderer/client.js';
import { GitTaskModelSettings } from '../../src/renderer/GitTaskModelSettings.js';
import { translateReviewMessage, type ReviewMessageKey } from '../../src/renderer/messages.js';

afterEach(cleanup);
const ui: ComponentProps<typeof GitTaskModelSettings>['ui'] = {
  Group: ({ title, children }) => <section><h2>{title}</h2>{children}</section>,
  Row: ({ label, children }) => <div>{label}{children}</div>,
  Section: ({ children }) => <div>{children}</div>,
  SelectField: ({ children, onValueChange, ...props }) => <select {...props} onChange={(event) => onValueChange(event.currentTarget.value)}>{children}</select>,
  Toast: ({ message }) => <p role="alert">{message}</p>,
  Button: ({ children, onClick, disabled }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
};

it('saves both dedicated Git models sequentially using the latest shared revision without enabling automatic repair', async () => {
  const models = ['commit', 'repair'].map((id) => ({ providerId: 'provider', providerName: 'Provider', modelId: id, modelName: id, modelCode: id }));
  let state = { settings: defaultGitSettings(), revision: 2, availableModels: models };
  const update = vi.fn<ReviewClient['updateGitSettings']>(async (input) => {
    expect(input.expectedRevision).toBe(state.revision);
    state = { ...state, settings: input.settings, revision: state.revision + 1 };
    return state;
  });
  render(<GitTaskModelSettings ui={ui} client={{ readGitSettings: async () => state, updateGitSettings: update }} translate={(key) => translateReviewMessage('zh-CN', key as ReviewMessageKey)} />);
  const commit = screen.getByRole('combobox', { name: '提交消息生成' }) as HTMLSelectElement;
  const repair = screen.getByRole('combobox', { name: 'Git 冲突解决' }) as HTMLSelectElement;
  await waitFor(() => expect(commit.disabled).toBe(false));
  fireEvent.change(commit, { target: { value: JSON.stringify(['provider', 'commit']) } });
  await waitFor(() => expect(repair.disabled).toBe(false));
  fireEvent.change(repair, { target: { value: JSON.stringify(['provider', 'repair']) } });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(state.settings).toEqual({ ...defaultGitSettings(), commitMessageModel: { providerId: 'provider', modelId: 'commit' }, conflictResolutionModel: { providerId: 'provider', modelId: 'repair' } });
  expect(state.revision).toBe(4);
});
