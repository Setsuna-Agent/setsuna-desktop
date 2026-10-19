import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { UsageBrandIconProps, UsageRendererHost } from '../../src/renderer/capabilities.js';
import { usageMessages } from '../../src/renderer/messages.js';
import { UsageViewProvider } from '../../src/renderer/usage/view-context.js';

export const usageTestTranslate: RendererTranslate = (key, params) => {
  const template = usageMessages.messages['zh-CN']?.[key] ?? key;
  return params
    ? template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match))
    : template;
};

export const usageTestUi = {
  Button: ({ children }: Readonly<{ children?: ReactNode }>) => <button type="button">{children}</button>,
  EmptyState: ({ title }: Readonly<{ title: string }>) => <div>{title}</div>,
  PageHeading: ({ action, description, title }: Readonly<{
    action?: ReactNode;
    description?: string;
    title: string;
  }>) => <header><h1>{title}</h1>{description ? <p>{description}</p> : null}{action}</header>,
  Section: ({ children }: Readonly<{ children: ReactNode }>) => <section>{children}</section>,
  // 原生 select 替代 Radix 下拉，测试可直接用 selectOptions 驱动筛选。
  SelectField: ({ children, onValueChange, value, 'aria-label': label }: Readonly<{
    'aria-label'?: string;
    children: ReactNode;
    onValueChange(value: string): void;
    value: string;
  }>) => (
    <select aria-label={label} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  Tooltip: ({ children, title }: Readonly<{ children: ReactElement; title: ReactNode }>) => (
    <span title={typeof title === 'string' ? title : undefined}>{children}</span>
  ),
} as unknown as SettingsViewUi;

const EmptyBrandIcon: ComponentType<UsageBrandIconProps> = () => null;

export function usageView(
  children: ReactNode,
  BrandIcon: ComponentType<UsageBrandIconProps> = EmptyBrandIcon,
) {
  const host: UsageRendererHost = { BrandIcon, Tooltip: usageTestUi.Tooltip };
  return (
    <UsageViewProvider host={host} translate={usageTestTranslate} ui={usageTestUi}>
      {children}
    </UsageViewProvider>
  );
}
