// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { Assistant, AssistantsSnapshot } from '../../src/contracts/index.js';
import { AssistantEditor } from '../../src/renderer/AssistantEditor.js';
import type { AssistantsRendererService } from '../../src/renderer/client.js';
import { createAssistantsStore } from '../../src/renderer/store.js';
import { deferred } from '../support/deferred.js';

const snapshot: AssistantsSnapshot = { assistants: [], conversations: [], tasks: [], reminders: [], peers: [], projects: [], models: [], connectors: [] };
const t: RendererTranslate = (key) => key;
afterEach(cleanup);

describe('助理编辑保存', () => {
  it('查看说明保留草稿，密钥保存失败后返回重试仍更新同一助理', async () => {
    const saved: Assistant = { id: 'assistant', name: '助理', personality: '', projectIds: [], qq: { appId: '123', enabled: true, markdownEnabled: false }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
    const client: AssistantsRendererService['client'] = {
      snapshot: vi.fn(async () => snapshot), create: vi.fn(async () => saved), update: vi.fn(async () => saved),
      delete: vi.fn(async () => ({ deleted: true })), openConversation: vi.fn(async () => ({ threadId: 'thread' })),
      updateSidebarEntry: vi.fn(), deleteSidebarEntry: vi.fn(),
      revealQqSecret: vi.fn(async () => ({ secret: null })),
      setQqSecret: vi.fn().mockRejectedValueOnce(new Error('密钥存储暂不可用')).mockResolvedValue({ configured: true }),
      updatePeer: vi.fn(async () => snapshot),
    };
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<AssistantEditor snapshot={snapshot} service={{ client, store: createAssistantsStore(client) }} translate={t}
      ui={{ Avatar: () => null, AvatarField: () => null, ModelPicker: () => null }} onSaved={onSaved} onDeleted={vi.fn()} onClose={onClose} />);
    const name = screen.getByRole('textbox', { name: 'feature.assistants.name' });
    fireEvent.change(name, { target: { value: '助理' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'feature.assistants.qqAppId' }), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('feature.assistants.qqSecret'), { target: { value: 'secret-for-retry' } });
    fireEvent.click(screen.getByRole('switch', { name: 'feature.assistants.qqMarkdownEnabled' }));
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqGuide' }));
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.back' }));
    const save = screen.getByRole('button', { name: 'feature.assistants.save' });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText('密钥存储暂不可用')).toBeTruthy());
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ qq: { appId: '123', enabled: true, markdownEnabled: false } }));
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: '修改后的助理' } });
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqGuide' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'feature.assistants.save' })).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledWith(saved.id, expect.objectContaining({ name: '修改后的助理', qq: { appId: '123', enabled: true, markdownEnabled: false } }));
    expect(client.setQqSecret).toHaveBeenNthCalledWith(2, saved.id, 'secret-for-retry');
  });

  it('已发起的旧快照或取消响应不能覆盖刚保存的配置', async () => {
    const first = deferred<AssistantsSnapshot>();
    const second = deferred<AssistantsSnapshot>();
    const source = { snapshot: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    const store = createAssistantsStore(source);
    const beforeMutation = store.refresh();
    const updated = { ...snapshot, assistants: [{ id: 'saved' } as Assistant] };
    store.publish(updated);
    first.resolve(snapshot);
    await beforeMutation;
    expect(store.getSnapshot()).toBe(updated);
    const controller = new AbortController();
    const cancelled = store.refresh(controller.signal);
    controller.abort();
    second.resolve(snapshot);
    await cancelled;
    expect(store.getSnapshot()).toBe(updated);
  });
});
