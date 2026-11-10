// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { AssistantQqSecretField } from '../../src/renderer/AssistantQqSecretField.js';
import { deferred } from '../support/deferred.js';

const t: RendererTranslate = (key) => key;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AppSecret 查看与复制', () => {
  it('显式操作才读取已保存的密钥，复制不显示明文，查看不修改替换草稿', async () => {
    const revealQqSecret = vi.fn(async () => ({ secret: 'saved-qq-secret' }));
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<AssistantQqSecretField assistantId="assistant" configured value="" disabled={false}
      client={{ revealQqSecret }} translate={t} onChange={onChange} onError={onError} />);
    const input = screen.getByLabelText<HTMLInputElement>('feature.assistants.qqSecret');
    expect(revealQqSecret).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqSecretCopy' }));
    await screen.findByRole('button', { name: 'feature.assistants.qqSecretCopied' });
    expect(write).toHaveBeenCalledExactlyOnceWith('saved-qq-secret');
    expect(input.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqSecretShow' }));
    await waitFor(() => expect(input.value).toBe('saved-qq-secret'));
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqSecretHide' }));
    expect(input.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['edit', 'close'] as const)('读取中 %s 后，迟到的旧密钥不能写入剪贴板', async (action) => {
    const response = deferred<{ secret: string | null }>();
    const revealQqSecret = vi.fn((_id: string, _signal?: AbortSignal) => response.promise);
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const onError = vi.fn();
    function Editor() {
      const [value, setValue] = useState('');
      return <AssistantQqSecretField assistantId="assistant" configured value={value} disabled={false}
        client={{ revealQqSecret }} translate={t} onChange={setValue} onError={onError} />;
    }
    const view = render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqSecretCopy' }));
    expect(revealQqSecret).toHaveBeenCalledTimes(1);
    const signal = revealQqSecret.mock.calls[0]![1]!;
    if (action === 'edit') {
      fireEvent.change(screen.getByLabelText('feature.assistants.qqSecret'), { target: { value: 'replacement-secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.qqSecretCopy' }));
      await screen.findByRole('button', { name: 'feature.assistants.qqSecretCopied' });
    } else view.unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => { response.resolve({ secret: 'outdated-secret' }); await response.promise; });
    if (action === 'edit') {
      expect(write).toHaveBeenCalledExactlyOnceWith('replacement-secret');
      expect(screen.getByLabelText<HTMLInputElement>('feature.assistants.qqSecret').value).toBe('replacement-secret');
    } else expect(write).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
