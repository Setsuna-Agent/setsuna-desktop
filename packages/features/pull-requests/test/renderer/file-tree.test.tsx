// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestFile } from '../../src/contracts/index.js';
import { PullRequestFileTree } from '../../src/renderer/PullRequestFileTree.js';

afterEach(cleanup);

it.each(['added', 'removed'])('allows selecting a %s file and changes beneath its former or new directory independently', async (status) => {
  const user = userEvent.setup();
  const file: PullRequestFile = { path: 'config', previousPath: null, status, additions: 1, deletions: 1 };
  const child: PullRequestFile = { ...file, path: 'config/database.yml', status: status === 'added' ? 'removed' : 'added' };
  const onSelect = vi.fn();
  render(<PullRequestFileTree files={status === 'added' ? [file, child] : [child, file]} path="config" onSelect={onSelect} />);
  const entries = screen.getAllByRole('button', { name: 'config', exact: true });
  const directory = entries.find((entry) => entry.hasAttribute('aria-expanded'))!;
  const target = entries.find((entry) => !entry.hasAttribute('aria-expanded'))!;
  await user.click(screen.getByRole('button', { name: 'database.yml' }));
  expect(onSelect).toHaveBeenLastCalledWith('config/database.yml');
  await user.click(target);
  expect(onSelect).toHaveBeenLastCalledWith('config');
  await user.click(directory);
  await user.click(target);
  expect(onSelect).toHaveBeenLastCalledWith('config');
  await user.click(directory);
  await user.click(screen.getByRole('button', { name: 'database.yml' }));
  expect(onSelect.mock.calls.map(([path]) => path)).toEqual(['config/database.yml', 'config', 'config', 'config/database.yml']);
});
