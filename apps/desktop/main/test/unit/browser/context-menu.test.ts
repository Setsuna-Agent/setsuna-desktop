import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import { createBrowserContextMenuTemplate } from '../../../src/browser/context-menu.js';

class FakeWebContents {
  readonly calls: string[] = [];
  destroyed = false;
  canGoBackValue = true;
  canGoForwardValue = false;

  canGoBack(): boolean { return this.canGoBackValue; }
  canGoForward(): boolean { return this.canGoForwardValue; }
  copy(): void { this.calls.push('copy'); }
  copyImageAt(x: number, y: number): void { this.calls.push(`copy-image:${x}:${y}`); }
  cut(): void { this.calls.push('cut'); }
  delete(): void { this.calls.push('delete'); }
  downloadURL(url: string): void { this.calls.push(`download:${url}`); }
  goBack(): void { this.calls.push('back'); }
  goForward(): void { this.calls.push('forward'); }
  isDestroyed(): boolean { return this.destroyed; }
  paste(): void { this.calls.push('paste'); }
  redo(): void { this.calls.push('redo'); }
  reload(): void { this.calls.push('reload'); }
  selectAll(): void { this.calls.push('select-all'); }
  undo(): void { this.calls.push('undo'); }
}

describe('browser context menu', () => {
  it('provides image actions and browser navigation for image previews', () => {
    const contents = new FakeWebContents();
    const copied: string[] = [];
    const opened: string[] = [];
    const imageUrl = 'http://127.0.0.1:58388/v1/file-previews/token/image.webp';
    const template = createBrowserContextMenuTemplate(asWebContents(contents), contextParams({
      hasImageContents: true,
      mediaType: 'image',
      srcURL: imageUrl,
      x: 32,
      y: 48,
    }), {
      canOpenInNewTab: (url) => url.startsWith('http'),
      copyText: (value) => copied.push(value),
      openInNewTab: (url) => opened.push(url),
    });

    expect(labels(template)).toEqual([
      '在新标签页中打开图片',
      '复制图片',
      '复制图片地址',
      '下载图片',
      '后退',
      '前进',
      '重新加载',
    ]);
    click(template, '在新标签页中打开图片');
    click(template, '复制图片');
    click(template, '复制图片地址');
    click(template, '下载图片');
    click(template, '后退');

    expect(opened).toEqual([imageUrl]);
    expect(copied).toEqual([imageUrl]);
    expect(contents.calls).toEqual([
      'copy-image:32:48',
      `download:${imageUrl}`,
      'back',
    ]);
    expect(template.find((item) => item.label === '前进')?.enabled).toBe(false);
  });

  it('uses guest edit commands and respects Chromium edit flags', () => {
    const contents = new FakeWebContents();
    const template = createBrowserContextMenuTemplate(asWebContents(contents), contextParams({
      editFlags: {
        canCopy: true,
        canCut: false,
        canDelete: false,
        canEditRichly: false,
        canPaste: true,
        canRedo: false,
        canSelectAll: true,
        canUndo: true,
      },
      isEditable: true,
    }), noOpOptions());

    click(template, '撤销');
    click(template, '复制');
    click(template, '粘贴');
    click(template, '全选');

    expect(contents.calls).toEqual(['undo', 'copy', 'paste', 'select-all']);
    expect(template.find((item) => item.label === '剪切')?.enabled).toBe(false);
    expect(template.find((item) => item.label === '重做')?.enabled).toBe(false);
  });

  it('localizes native browser actions in English', () => {
    const contents = new FakeWebContents();
    const template = createBrowserContextMenuTemplate(asWebContents(contents), contextParams({
      linkURL: 'https://example.com/docs',
      selectionText: 'selected',
      editFlags: {
        canCopy: true,
        canCut: false,
        canDelete: false,
        canEditRichly: false,
        canPaste: false,
        canRedo: false,
        canSelectAll: false,
        canUndo: false,
      },
    }), {
      ...noOpOptions(),
      canOpenInNewTab: () => true,
      locale: 'en-US',
    });

    expect(labels(template)).toEqual([
      'Open link in new tab',
      'Copy link address',
      'Copy',
      'Back',
      'Forward',
      'Reload',
    ]);
  });

  it('does not execute a stale menu command after the guest is destroyed', () => {
    const contents = new FakeWebContents();
    const template = createBrowserContextMenuTemplate(
      asWebContents(contents),
      contextParams(),
      noOpOptions(),
    );
    contents.destroyed = true;

    click(template, '重新加载');

    expect(contents.calls).toEqual([]);
  });
});

function contextParams(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    altText: '',
    dictionarySuggestions: [],
    editFlags: {
      canCopy: false,
      canCut: false,
      canDelete: false,
      canEditRichly: false,
      canPaste: false,
      canRedo: false,
      canSelectAll: false,
      canUndo: false,
    },
    formControlType: 'none',
    frame: null,
    frameCharset: 'UTF-8',
    frameURL: 'https://example.com/',
    hasImageContents: false,
    isEditable: false,
    linkText: '',
    linkURL: '',
    mediaFlags: {
      canLoop: false,
      canPrint: false,
      canRotate: false,
      canSave: false,
      canShowPictureInPicture: false,
      canToggleControls: false,
      hasAudio: false,
      inError: false,
      isControlsVisible: false,
      isLooping: false,
      isMuted: false,
      isPaused: false,
      isShowingPictureInPicture: false,
    },
    mediaType: 'none',
    menuSourceType: 'mouse',
    misspelledWord: '',
    pageURL: 'https://example.com/',
    referrerPolicy: { policy: 'default', url: '' },
    selectionRect: { height: 0, width: 0, x: 0, y: 0 },
    selectionStartOffset: 0,
    selectionText: '',
    spellcheckEnabled: false,
    srcURL: '',
    suggestedFilename: '',
    titleText: '',
    x: 10,
    y: 20,
    ...overrides,
  };
}

function asWebContents(contents: FakeWebContents): WebContents {
  return contents as unknown as WebContents;
}

function labels(template: MenuItemConstructorOptions[]): string[] {
  return template.flatMap((item) => item.label ? [item.label] : []);
}

function click(template: MenuItemConstructorOptions[], label: string): void {
  const item = template.find((candidate) => candidate.label === label);
  expect(item, `Missing menu item: ${label}`).toBeDefined();
  (item?.click as (() => void) | undefined)?.();
}

function noOpOptions() {
  return {
    canOpenInNewTab: () => false,
    copyText: () => undefined,
    openInNewTab: () => undefined,
  };
}
