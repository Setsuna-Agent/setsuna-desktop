import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { BrowserReloadShortcutBindings } from '../contracts/index.js';
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';
import { createBrowserNativeTranslate, type BrowserNativeTranslate } from './native-messages.js';

type BrowserContextMenuParams = Pick<
  ContextMenuParams,
  | 'editFlags'
  | 'hasImageContents'
  | 'isEditable'
  | 'linkURL'
  | 'mediaType'
  | 'selectionText'
  | 'srcURL'
  | 'x'
  | 'y'
>;

type BrowserContextMenuOptions = {
  canOpenInNewTab(url: string): boolean;
  copyText(value: string): void;
  locale?: RuntimeInterfaceLanguage;
  openInNewTab(url: string): void;
};

export function createBrowserContextMenuTemplate(
  contents: WebContents,
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const t = createBrowserNativeTranslate(options.locale ?? 'zh-CN');

  appendMenuGroup(items, linkMenuItems(params, options, t));
  appendMenuGroup(items, imageMenuItems(contents, params, options, t));
  appendMenuGroup(items, editMenuItems(contents, params, t));
  appendMenuGroup(items, navigationMenuItems(contents, t));

  return items;
}

export function createBrowserReloadMenuTemplate(
  contents: WebContents,
  locale: RuntimeInterfaceLanguage = 'zh-CN',
  shortcutBindings?: BrowserReloadShortcutBindings,
): MenuItemConstructorOptions[] {
  const t = createBrowserNativeTranslate(locale);
  return [
    reloadCommand(
      contents,
      t('browser.normalReload'),
      browserShortcutAccelerator(shortcutBindings?.normal ?? null),
      () => contents.reload(),
    ),
    reloadCommand(
      contents,
      t('browser.hardReload'),
      browserShortcutAccelerator(shortcutBindings?.hard ?? null),
      () => contents.reloadIgnoringCache(),
    ),
    {
      click: () => { void clearCacheAndHardReload(contents); },
      label: t('browser.emptyCacheAndHardReload'),
    },
  ];
}

const electronAcceleratorKeyByCode: Readonly<Record<string, string>> = Object.freeze({
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backspace: 'Backspace',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Home: 'Home',
  Insert: 'Insert',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Space: 'Space',
  Tab: 'Tab',
});

function browserShortcutAccelerator(binding: string | null): string | undefined {
  if (!binding) return undefined;
  const tokens = binding.split('+');
  const code = tokens.pop();
  if (!code) return undefined;
  const modifiers = tokens.map((modifier) => ({
    Alt: 'Alt',
    Control: 'Ctrl',
    Meta: 'Command',
    Shift: 'Shift',
  } as const)[modifier]);
  if (modifiers.some((modifier) => !modifier)) return undefined;
  const key = /^Key[A-Z]$/u.test(code)
    ? code.slice(3)
    : /^Digit\d$/u.test(code)
      ? code.slice(5)
      : /^F(?:[1-9]|1\d|2[0-4])$/u.test(code)
        ? code
        : electronAcceleratorKeyByCode[code];
  return key ? [...modifiers, key].join('+') : undefined;
}

function linkMenuItems(
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
  t: BrowserNativeTranslate,
): MenuItemConstructorOptions[] {
  if (!params.linkURL) return [];
  return [
    ...(options.canOpenInNewTab(params.linkURL) ? [{
      click: () => options.openInNewTab(params.linkURL),
      label: t('browser.openLinkInNewTab'),
    }] : []),
    {
      click: () => options.copyText(params.linkURL),
      label: t('browser.copyLinkAddress'),
    },
  ];
}

function imageMenuItems(
  contents: WebContents,
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
  t: BrowserNativeTranslate,
): MenuItemConstructorOptions[] {
  if (params.mediaType !== 'image' && !params.hasImageContents) return [];
  const srcURL = params.srcURL.trim();
  return [
    ...(srcURL && options.canOpenInNewTab(srcURL) ? [{
      click: () => options.openInNewTab(srcURL),
      label: t('browser.openImageInNewTab'),
    }] : []),
    ...(params.hasImageContents ? [{
      click: () => runGuestAction(contents, () => contents.copyImageAt(params.x, params.y)),
      label: t('browser.copyImage'),
    }] : []),
    ...(srcURL ? [{
      click: () => options.copyText(srcURL),
      label: t('browser.copyImageAddress'),
    }, {
      click: () => runGuestAction(contents, () => contents.downloadURL(srcURL)),
      label: t('browser.downloadImage'),
    }] : []),
  ];
}

function editMenuItems(
  contents: WebContents,
  params: BrowserContextMenuParams,
  t: BrowserNativeTranslate,
): MenuItemConstructorOptions[] {
  const { editFlags } = params;
  if (params.isEditable) {
    return [
      guestCommand(contents, t('browser.undo'), editFlags.canUndo, () => contents.undo()),
      guestCommand(contents, t('browser.redo'), editFlags.canRedo, () => contents.redo()),
      { type: 'separator' },
      guestCommand(contents, t('browser.cut'), editFlags.canCut, () => contents.cut()),
      guestCommand(contents, t('browser.copy'), editFlags.canCopy, () => contents.copy()),
      guestCommand(contents, t('browser.paste'), editFlags.canPaste, () => contents.paste()),
      guestCommand(contents, t('browser.delete'), editFlags.canDelete, () => contents.delete()),
      { type: 'separator' },
      guestCommand(contents, t('browser.selectAll'), editFlags.canSelectAll, () => contents.selectAll()),
    ];
  }
  if (!params.selectionText) return [];
  return [guestCommand(contents, t('browser.copy'), editFlags.canCopy, () => contents.copy())];
}

function navigationMenuItems(contents: WebContents, t: BrowserNativeTranslate): MenuItemConstructorOptions[] {
  return [
    guestCommand(contents, t('browser.back'), contents.canGoBack(), () => contents.goBack()),
    guestCommand(contents, t('browser.forward'), contents.canGoForward(), () => contents.goForward()),
    guestCommand(contents, t('browser.reload'), true, () => contents.reload()),
  ];
}

function guestCommand(
  contents: WebContents,
  label: string,
  enabled: boolean,
  action: () => void,
): MenuItemConstructorOptions {
  return {
    click: () => runGuestAction(contents, action),
    enabled,
    label,
  };
}

function reloadCommand(
  contents: WebContents,
  label: string,
  accelerator: string | undefined,
  action: () => void,
): MenuItemConstructorOptions {
  return {
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => runGuestAction(contents, action),
    label,
    // The renderer shortcut registry owns execution; the native menu only
    // displays the current binding and must not register a competing shortcut.
  };
}

async function clearCacheAndHardReload(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return;
  try {
    await contents.session.clearCache();
    if (!contents.isDestroyed()) contents.reloadIgnoringCache();
  } catch {
    // 清理缓存期间 guest 或其 session 可能已随标签页关闭而销毁。
  }
}

function runGuestAction(contents: WebContents, action: () => void): void {
  if (contents.isDestroyed()) return;
  try {
    action();
  } catch {
    // 菜单打开到点击之间 guest 可能已因切换标签或导航而分离。
  }
}

function appendMenuGroup(
  target: MenuItemConstructorOptions[],
  group: MenuItemConstructorOptions[],
): void {
  if (!group.length) return;
  if (target.length) target.push({ type: 'separator' });
  target.push(...group);
}
