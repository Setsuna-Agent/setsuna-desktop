// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, Checkbox, IconButton, SelectField, TextArea, TextField } from '@setsuna-desktop/renderer-ui';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { McpRendererService } from '../../src/contracts/index.js';
import { McpCapabilitiesPage } from '../../src/renderer/McpCapabilitiesPage.js';

afterEach(cleanup);

function setup(methods: Partial<McpRendererService>) {
  const snapshot = { servers: [], errors: [] };
  const service = { getSnapshot: () => snapshot, subscribe: () => () => undefined, ...methods } as McpRendererService;
  const capabilities = {
    renderBreadcrumb: ({ onBack }) => <Button onClick={onBack}>Back</Button>,
    renderCreateMenu: ({ items }) => <Button onClick={items[1].onSelect}>Create MCP</Button>,
  } as CapabilitiesPageNavigation;
  const ui = {
    Button, Checkbox, IconButton, SelectField, TextArea, TextField,
    PageHeader: ({ title, actions }) => <header><h2>{title}</h2>{actions}</header>,
    Toast: ({ message }) => <div role="alert">{message}</div>,
  } as SettingsViewUi;
  render(<McpCapabilitiesPage sectionId="mcp" service={service} capabilities={capabilities} ui={ui} openExternal={async () => true} translate={(key) => key} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create MCP' }));
  fireEvent.change(screen.getByPlaceholderText('server-key'), { target: { value: 'draft' } });
  return service;
}

it('retains a failed MCP save for correction and prevents edits or duplicate saves while pending', async () => {
  const user = userEvent.setup();
  let rejectSave!: (reason: Error) => void;
  const saveServer = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }))
    .mockResolvedValueOnce({ servers: [], errors: [] });
  setup({ saveServer });
  const name = screen.getByPlaceholderText('Search MCP') as HTMLInputElement;
  await user.type(name, 'My server');
  const save = screen.getByRole('button', { name: 'feature.mcp.save' });
  await user.click(save);
  fireEvent.click(save);
  await user.type(name, ' unsaved');
  await user.click(screen.getByRole('combobox'));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(saveServer).toHaveBeenCalledOnce();
  expect(name.value).toBe('My server');
  await act(async () => rejectSave(new Error('Invalid server')));
  expect(screen.getByRole('alert').textContent).toBe('Invalid server');
  await user.type(name, ' corrected');
  await user.click(screen.getByRole('button', { name: 'feature.mcp.save' }));
  expect(saveServer).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'draft', label: 'My server corrected' }));
  await waitFor(() => expect(screen.queryByPlaceholderText('server-key')).toBeNull());
});

it('does not close a new MCP editor when an earlier save finishes', async () => {
  let finish!: () => void;
  const saveServer = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  setup({ saveServer: saveServer as unknown as McpRendererService['saveServer'] });
  fireEvent.click(screen.getByRole('button', { name: 'feature.mcp.save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create MCP' }));
  const name = screen.getByPlaceholderText('Search MCP') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Next draft' } });
  await act(async () => finish());
  expect(screen.getByPlaceholderText('Search MCP')).toBe(name);
  expect(name.value).toBe('Next draft');
});

it('discards discovered tools after the connection draft changes and accepts the next discovery', async () => {
  let finish!: (value: { tools: { name: string }[]; errors: string[] }) => void;
  const discoverTools = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ tools: [{ name: 'current_tool' }], errors: [] });
  setup({ discoverTools });
  fireEvent.click(screen.getByRole('button', { name: 'feature.mcp.fetchTools' }));
  fireEvent.change(screen.getByPlaceholderText('Search MCP'), { target: { value: 'Changed connection draft' } });
  expect(discoverTools.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finish({ tools: [{ name: 'old_tool' }], errors: ['Old connection error'] }));
  expect(screen.queryByText('old_tool')).toBeNull();
  expect(screen.queryByText('Old connection error')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'feature.mcp.fetchTools' }));
  expect(await screen.findByText('current_tool')).toBeTruthy();
});
