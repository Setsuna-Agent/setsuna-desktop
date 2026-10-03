import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { computerStopShortcuts } from '../contracts/index.js';

export const controlIndicatorStopUrl = 'setsuna-computer-control://stop';

// Both native layers use script-free pages. Only the toolbar's exact stop URL
// is handled by main; neither page loads the privileged app renderer.
function page(language: string, styles: string, body: string): string {
  const html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    body { color: #f5f5f5; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none; }
    ${styles}
  </style>
</head>
<body>${body}</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function controlIndicatorBorderPage(): string {
  return page('en', `
    .screen-border { position: fixed; inset: 0; border: 5px solid #7896ff; box-shadow: inset 0 0 0 1px #d7e2ffb3, inset 0 0 28px 6px #6488ff73; pointer-events: none; }
  `, '<div class="screen-border" aria-hidden="true"></div>');
}

export function controlIndicatorToolbarPage(language: RuntimeInterfaceLanguage, platform: NodeJS.Platform): string {
  const english = language === 'en-US';
  const shortcut = computerStopShortcuts[platform === 'darwin' ? 'darwin' : 'win32'];
  const keys = shortcut.label.split(' + ').map((key) => `<kbd>${key}</kbd>`).join('<span class="plus">+</span>');
  return page(english ? 'en' : 'zh-CN', `
    body { padding: 10px; }
    .notice { display: flex; align-items: center; gap: 12px; width: 100%; height: 100%; padding: 10px 12px; border: 1px solid #ffffff38; border-radius: 14px; background: #202020b8; box-shadow: 0 3px 10px #00000026; white-space: nowrap; -webkit-app-region: drag; }
    .notice:hover { background: #202020d9; }
    .grip { flex: none; width: 12px; height: 18px; color: #ffffff80; }
    .status { display: flex; align-items: center; gap: 9px; margin-right: auto; font-weight: 500; }
    .icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: #bdccff; background: #7896ff33; }
    .icon svg { width: 17px; height: 17px; }
    .keys { display: flex; align-items: center; gap: 4px; }
    .plus { color: #ffffffa6; font-size: 11px; }
    kbd { padding: 3px 5px; border: 1px solid #ffffff24; border-radius: 5px; background: #ffffff0d; color: #f5f5f5; font: inherit; font-size: 11px; font-weight: 500; line-height: 1.4; }
    .stop { display: inline-flex; flex: none; align-items: center; gap: 6px; padding: 5px 9px; border: 1px solid #ffffff38; border-radius: 7px; background: #ffffff14; color: #ffffff; font-size: 12px; text-decoration: none; cursor: pointer; -webkit-app-region: no-drag; }
    .stop:hover { background: #ffffff2e; }
    .stop:active { background: #ffffff40; }
    .stop svg { width: 9px; height: 9px; }
  `, `
  <aside class="notice" role="status" title="${english ? 'Drag to move' : '拖动调整位置'}">
    <svg class="grip" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="4" r="1"/><circle cx="9" cy="4" r="1"/><circle cx="3" cy="9" r="1"/><circle cx="9" cy="9" r="1"/><circle cx="3" cy="14" r="1"/><circle cx="9" cy="14" r="1"/></svg>
    <span class="status">
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></span>
      ${english ? 'AI is controlling your computer' : 'AI 正在控制电脑'}
    </span>
    <span class="keys" aria-label="${shortcut.label}">${keys}</span>
    <a class="stop" role="button" href="${controlIndicatorStopUrl}" title="${english ? 'Stop immediately' : '强制停止'} (${shortcut.label})"><svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1.5"/></svg>${english ? 'Stop' : '停止操作'}</a>
  </aside>`);
}
