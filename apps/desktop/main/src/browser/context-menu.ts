import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';

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
  openInNewTab(url: string): void;
};

export function createBrowserContextMenuTemplate(
  contents: WebContents,
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  appendMenuGroup(items, linkMenuItems(params, options));
  appendMenuGroup(items, imageMenuItems(contents, params, options));
  appendMenuGroup(items, editMenuItems(contents, params));
  appendMenuGroup(items, navigationMenuItems(contents));

  return items;
}

function linkMenuItems(
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
): MenuItemConstructorOptions[] {
  if (!params.linkURL) return [];
  return [
    ...(options.canOpenInNewTab(params.linkURL) ? [{
      click: () => options.openInNewTab(params.linkURL),
      label: '在新标签页中打开链接',
    }] : []),
    {
      click: () => options.copyText(params.linkURL),
      label: '复制链接地址',
    },
  ];
}

function imageMenuItems(
  contents: WebContents,
  params: BrowserContextMenuParams,
  options: BrowserContextMenuOptions,
): MenuItemConstructorOptions[] {
  if (params.mediaType !== 'image' && !params.hasImageContents) return [];
  const srcURL = params.srcURL.trim();
  return [
    ...(srcURL && options.canOpenInNewTab(srcURL) ? [{
      click: () => options.openInNewTab(srcURL),
      label: '在新标签页中打开图片',
    }] : []),
    ...(params.hasImageContents ? [{
      click: () => runGuestAction(contents, () => contents.copyImageAt(params.x, params.y)),
      label: '复制图片',
    }] : []),
    ...(srcURL ? [{
      click: () => options.copyText(srcURL),
      label: '复制图片地址',
    }, {
      click: () => runGuestAction(contents, () => contents.downloadURL(srcURL)),
      label: '下载图片',
    }] : []),
  ];
}

function editMenuItems(
  contents: WebContents,
  params: BrowserContextMenuParams,
): MenuItemConstructorOptions[] {
  const { editFlags } = params;
  if (params.isEditable) {
    return [
      guestCommand(contents, '撤销', editFlags.canUndo, () => contents.undo()),
      guestCommand(contents, '重做', editFlags.canRedo, () => contents.redo()),
      { type: 'separator' },
      guestCommand(contents, '剪切', editFlags.canCut, () => contents.cut()),
      guestCommand(contents, '复制', editFlags.canCopy, () => contents.copy()),
      guestCommand(contents, '粘贴', editFlags.canPaste, () => contents.paste()),
      guestCommand(contents, '删除', editFlags.canDelete, () => contents.delete()),
      { type: 'separator' },
      guestCommand(contents, '全选', editFlags.canSelectAll, () => contents.selectAll()),
    ];
  }
  if (!params.selectionText) return [];
  return [guestCommand(contents, '复制', editFlags.canCopy, () => contents.copy())];
}

function navigationMenuItems(contents: WebContents): MenuItemConstructorOptions[] {
  return [
    guestCommand(contents, '后退', contents.canGoBack(), () => contents.goBack()),
    guestCommand(contents, '前进', contents.canGoForward(), () => contents.goForward()),
    guestCommand(contents, '重新加载', true, () => contents.reload()),
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
