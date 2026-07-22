import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';
import { createNativeTranslate, type NativeTranslate } from '../i18n/native-messages.js';

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
  const t = createNativeTranslate(options.locale ?? 'zh-CN');

  appendMenuGroup(items, linkMenuItems(params, options, t));
  appendMenuGroup(items, imageMenuItems(contents, params, options, t));
  appendMenuGroup(items, editMenuItems(contents, params, t));
  appendMenuGroup(items, navigationMenuItems(contents, t));

  return items;
}

function linkMenuItems(
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
  t: NativeTranslate,
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
  t: NativeTranslate,
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
  t: NativeTranslate,
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

function navigationMenuItems(contents: WebContents, t: NativeTranslate): MenuItemConstructorOptions[] {
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
