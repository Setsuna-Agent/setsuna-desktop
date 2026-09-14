// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarProjectHoverCard } from '../../../../src/app/sidebar/SidebarProjectHoverCard.js';

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('opens project editing from the hover card without selecting the project', async () => {
  const project: WorkspaceProject = {
    id: 'project-1', name: 'viper', path: '/workspace/viper',
    createdAt: '', updatedAt: '',
  };
  const onEditProject = vi.fn();
  const onSelectProject = vi.fn();
  const content = (disabled = false) => (
    <SidebarProjectHoverCard disabled={disabled} project={project} threadCount={3} onEditProject={onEditProject}>
      <div><Button onClick={onSelectProject}>{project.name}</Button></div>
    </SidebarProjectHoverCard>
  );
  const view = render(content());
  const trigger = screen.getByRole('button', { name: project.name }).parentElement!;
  const preview = () => document.querySelector<HTMLElement>('.desktop-agent-project-preview');
  // Supply the visible anchor geometry that happy-dom cannot lay out itself.
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(8, 60, 220, 32));
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);

  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  expect(preview()).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(preview()).not.toBeNull();
  const card = preview()!;

  // Crossing from the sidebar into the card must keep its edit action available.
  fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
  fireEvent.pointerEnter(card, { pointerType: 'mouse' });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(preview()).toBe(card);
  fireEvent.click(within(card).getByRole('button', { name: '编辑项目' }));
  expect(onEditProject).toHaveBeenCalledExactlyOnceWith(project);
  expect(onSelectProject).not.toHaveBeenCalled();
  expect(preview()).toBeNull();

  view.rerender(content(true));
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(preview()).toBeNull();
});
