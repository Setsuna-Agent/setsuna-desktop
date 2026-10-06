// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BrandIconPickerDialog } from '../../../../src/shared/branding/BrandIconPickerDialog.js';

afterEach(cleanup);

it('selects a library icon and preserves that draft while searching for another brand', () => {
  const onConfirm = vi.fn();
  render(
    <BrandIconPickerDialog
      automaticBrand={null}
      name="Custom provider"
      subject="provider"
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  const search = screen.getByRole('searchbox', { name: '搜索品牌图标' });
  fireEvent.change(search, { target: { value: 'open router' } });
  fireEvent.click(screen.getByRole('radio', { name: 'OpenRouter' }));
  fireEvent.change(search, { target: { value: '腾讯混元' } });
  expect(screen.getByRole('radio', { name: 'Hunyuan' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '应用图标' }));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ type: 'preset', key: 'openrouter' });
});
