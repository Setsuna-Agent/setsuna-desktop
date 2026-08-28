// @vitest-environment happy-dom

import type { RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeActivityConversationServiceList } from '../../src/renderer/RuntimeActivityConversationServiceList.js';
import { runtimeActivityTestTranslate } from './support.js';

const service: RuntimeBackgroundShellProcess = {
  command: 'pnpm dev\n  --host 127.0.0.1',
  directory: 'apps/web',
  expiresAt: '2026-07-20T08:00:00.000Z',
  id: 'shell_1',
  startedAt: '2026-07-20T02:00:00.000Z',
  threadId: 'thread_1',
  toolCallId: 'call_1',
  turnId: 'turn_1',
};

afterEach(cleanup);

describe('RuntimeActivityConversationServiceList', () => {
  it('renders no panel chrome without a running service', () => {
    const html = renderToStaticMarkup(
      <RuntimeActivityConversationServiceList
        error={null}
        onStop={vi.fn()}
        services={[]}
        stoppingIds={new Set()}
        translate={runtimeActivityTestTranslate}
      />,
    );

    expect(html).toBe('');
  });

  it('exposes a Feature-owned stop action for the conversation service', () => {
    const onStop = vi.fn();
    const { getByRole } = render(
      <RuntimeActivityConversationServiceList
        error={null}
        onStop={onStop}
        services={[service]}
        stoppingIds={new Set()}
        translate={runtimeActivityTestTranslate}
      />,
    );

    expect(getByRole('region', { name: '后台服务' }).textContent)
      .toContain('pnpm dev --host 127.0.0.1');
    fireEvent.click(getByRole('button', {
      name: '终止后台服务：pnpm dev --host 127.0.0.1',
    }));
    expect(onStop).toHaveBeenCalledWith(service.id);
  });

  it('disables duplicate stop actions while the service is stopping', () => {
    const { getByRole } = render(
      <RuntimeActivityConversationServiceList
        error={null}
        onStop={vi.fn()}
        services={[service]}
        stoppingIds={new Set([service.id])}
        translate={runtimeActivityTestTranslate}
      />,
    );

    const button = getByRole('button', {
      name: '终止后台服务：pnpm dev --host 127.0.0.1',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('正在终止服务');
  });
});
