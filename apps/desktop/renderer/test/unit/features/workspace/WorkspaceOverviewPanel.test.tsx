// @vitest-environment happy-dom

import { temporaryWorkspaceProjectId, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { browserRendererFeature } from '@setsuna-desktop/feature-browser/renderer';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceOverviewPanel } from '../../../../src/features/workspace/WorkspaceOverviewPanel.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); window.localStorage.clear(); });
const messages = composeRendererMessages(hostMessages, [{ module: browserRendererFeature }]);
function Providers({ children }: PropsWithChildren) {
  return <I18nProvider initialLocale="zh-CN" messageCatalog={messages}><ToastProvider>{children}</ToastProvider></I18nProvider>;
}
const project = {
  id: 'project_1', name: 'Fixture', path: '/tmp/fixture',
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
} satisfies WorkspaceProject;
const baseProps = {
  activeProject: project, isGitRepository: false,
  onOpenBrowser: () => undefined, onOpenFilesPanel: () => undefined, onOpenReviewPanel: () => undefined,
  onOpenChangesPanel: () => undefined, onOpenSideChat: () => undefined, onOpenTerminalPanel: () => undefined,
};

it('routes workspace actions without forwarding click events as browser URLs', () => {
  const onOpenReviewPanel = vi.fn();
  const onOpenChangesPanel = vi.fn();
  const onOpenSideChat = vi.fn();
  const onOpenBrowser = vi.fn();
  render(<WorkspaceOverviewPanel {...baseProps} isGitRepository onOpenReviewPanel={onOpenReviewPanel}
    onOpenChangesPanel={onOpenChangesPanel} onOpenSideChat={onOpenSideChat} onOpenBrowser={onOpenBrowser} />, { wrapper: Providers });
  for (const name of [/^审查/, /^变更/, /^侧边/, /^浏览器/]) fireEvent.click(screen.getByRole('button', { name }));
  expect(onOpenReviewPanel).toHaveBeenCalledExactlyOnceWith();
  expect(onOpenChangesPanel).toHaveBeenCalledExactlyOnceWith();
  expect(onOpenSideChat).toHaveBeenCalledOnce();
  expect(onOpenBrowser).toHaveBeenCalledExactlyOnceWith();
});

it('opens conversation debug only when the developer action is provided', () => {
  const onOpenConversationDebug = vi.fn();
  const view = render(<WorkspaceOverviewPanel {...baseProps} />, { wrapper: Providers });
  expect(screen.queryByRole('button', { name: /^对话调试/ })).toBeNull();
  view.rerender(<WorkspaceOverviewPanel {...baseProps} onOpenConversationDebug={onOpenConversationDebug} />);
  fireEvent.click(screen.getByRole('button', { name: /^对话调试/ }));
  expect(onOpenConversationDebug).toHaveBeenCalledOnce();
});

it.each([false, true])('enables single-directory Git changes only for a repository (isGitRepository=%s)', (isGitRepository) => {
  render(<WorkspaceOverviewPanel {...baseProps} isGitRepository={isGitRepository} />, { wrapper: Providers });
  expect(Boolean(screen.queryByRole('button', { name: /^变更/ }))).toBe(isGitRepository);
});

it('opens Changes for an attached repository when the primary directory is not Git', () => {
  const onOpenChangesPanel = vi.fn();
  render(<WorkspaceOverviewPanel {...baseProps} activeProject={{
    ...project,
    roots: [
      { id: 'primary', path: project.path },
      { id: 'attached', path: '/tmp/attached-repository', gitRoot: '/tmp/attached-repository' },
    ],
  }} isGitRepository={false} onOpenChangesPanel={onOpenChangesPanel} />, { wrapper: Providers });

  fireEvent.click(screen.getByRole('button', { name: /^变更/ }));
  expect(onOpenChangesPanel).toHaveBeenCalledExactlyOnceWith();
});

it('allows workspace actions in the temporary directory of an ordinary conversation', () => {
  render(<WorkspaceOverviewPanel {...baseProps} activeProject={{
    ...project, id: temporaryWorkspaceProjectId({ date: '2026-07-18', threadId: 'thread_1' }), name: '临时目录',
  }} />, { wrapper: Providers });
  for (const name of [/^审查/, /^文件/, /^终端/]) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
  }
});
