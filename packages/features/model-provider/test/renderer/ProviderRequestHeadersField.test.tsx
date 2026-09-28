// @vitest-environment happy-dom

import type { ProviderRequestHeaders } from '@setsuna-desktop/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProviderRequestHeaders } from '../../src/contracts/index.js';
import { ProviderRequestHeadersField } from '../../src/renderer/ProviderRequestHeadersField.js';
import { modelProviderMessages } from '../../src/renderer/messages.js';

afterEach(cleanup);

describe('request header row editor', () => {
  it('keeps input and focus through normalized saves, and holds incomplete or duplicate rows locally', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<Editor onChange={onChange} onValidityChange={onValidityChange} />);
    const name = screen.getByLabelText('请求头名称 1') as HTMLInputElement;
    const value = screen.getByLabelText('请求头值 1') as HTMLInputElement;
    expect(onChange).not.toHaveBeenCalled();
    await user.type(name, 'X-Route');
    await user.type(value, ' https://proxy.test:8443 ');
    expect(name.value).toBe('X-Route');
    expect(value.value).toBe(' https://proxy.test:8443 ');
    expect(document.activeElement).toBe(value);
    expect(onChange).toHaveBeenLastCalledWith({ 'x-route': 'https://proxy.test:8443' });

    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: '添加请求头' }));
    expect(document.activeElement).toBe(screen.getByLabelText('请求头名称 2'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('请求头值 2'), { target: { value: '{{sessionId}}' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('请求头名称 2'), { target: { value: 'x-route' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('请求头名称 2'), { target: { value: 'X-Session' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenLastCalledWith({
      'x-route': 'https://proxy.test:8443', 'x-session': '{{sessionId}}',
    });
    await user.click(screen.getByRole('button', { name: '删除第 1 个请求头' }));
    expect(onChange).toHaveBeenLastCalledWith({ 'x-session': '{{sessionId}}' });
  });

  it('removes preset headers explicitly and restores defaults after an invalid draft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<Editor catalogProviderId="opencode-go" onChange={onChange} onValidityChange={onValidityChange} />);
    await user.click(screen.getByRole('button', { name: '删除第 1 个请求头' }));
    await user.click(screen.getByRole('button', { name: '删除第 1 个请求头' }));
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.change(screen.getByLabelText('请求头值 1'), { target: { value: 'unfinished' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    const expected = Object.entries(defaultProviderRequestHeaders('opencode-go'));
    for (const [index, [name, value]] of expected.entries()) {
      expect((screen.getByLabelText(`请求头名称 ${index + 1}`) as HTMLInputElement).value).toBe(name);
      expect((screen.getByLabelText(`请求头值 ${index + 1}`) as HTMLInputElement).value).toBe(value);
    }
  });

  it('discards an unfinished draft when external provider settings change', () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    const props = { onChange, onValidityChange, translate, ui };
    const view = render(<ProviderRequestHeadersField {...props} requestHeaders={{ 'x-old': 'old' }} />);
    fireEvent.change(screen.getByLabelText('请求头名称 1'), { target: { value: 'bad name' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<ProviderRequestHeadersField {...props} requestHeaders={{ 'x-new': 'new' }} />);
    expect((screen.getByLabelText('请求头名称 1') as HTMLInputElement).value).toBe('x-new');
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });
});

function Editor(props: Pick<ComponentProps<typeof ProviderRequestHeadersField>, 'catalogProviderId' | 'onChange' | 'onValidityChange'>) {
  const [headers, setHeaders] = useState<ProviderRequestHeaders>();
  return <ProviderRequestHeadersField {...props} requestHeaders={headers} translate={translate} ui={ui} onChange={(next) => {
    props.onChange(next);
    setHeaders(next);
  }} />;
}

const translate: ComponentProps<typeof ProviderRequestHeadersField>['translate'] = (key, params) => {
  const template = modelProviderMessages.messages['zh-CN']?.[key] ?? key;
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params?.[name] ?? match));
};

const ui = {
  Button: ({ children, icon: _icon, variant: _variant, ...props }: ComponentProps<SettingsViewUi['Button']>) => (
    <button type="button" {...props}>{children}</button>
  ),
  IconButton: ({ children, label, variant: _variant, ...props }: ComponentProps<SettingsViewUi['IconButton']>) => (
    <button type="button" aria-label={label} {...props}>{children}</button>
  ),
  TextField: (props: ComponentProps<SettingsViewUi['TextField']>) => <input {...props} />,
  Tooltip: ({ children }: ComponentProps<SettingsViewUi['Tooltip']>) => children,
} as unknown as SettingsViewUi;
