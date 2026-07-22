import androidStudioIconUrl from './assets/android-studio.svg';
import clionIconUrl from './assets/clion.svg';
import cursorIconUrl from './assets/cursor.svg';
import datagripIconUrl from './assets/datagrip.svg';
import eclipseIconUrl from './assets/eclipse.svg';
import golandIconUrl from './assets/goland.svg';
import intellijIdeaIconUrl from './assets/intellij-idea.svg';
import netbeansIconUrl from './assets/netbeans.svg';
import phpstormIconUrl from './assets/phpstorm.svg';
import pycharmIconUrl from './assets/pycharm.svg';
import riderIconUrl from './assets/rider.svg';
import rubymineIconUrl from './assets/rubymine.svg';
import sublimeTextIconUrl from './assets/sublime-text.svg';
import visualStudioIconUrl from './assets/visual-studio.svg';
import vscodeIconUrl from './assets/vscode.svg';
import webstormIconUrl from './assets/webstorm.svg';
import windsurfIconUrl from './assets/windsurf.svg';
import xcodeIconUrl from './assets/xcode.svg';
import zedIconUrl from './assets/zed.svg';

export type WorkspaceAppIconAsset = {
  src: string;
  monochrome?: boolean;
};

function monochromeIcon(src: string): WorkspaceAppIconAsset {
  return { src, monochrome: true };
}

export const workspaceAppIconAssets: Readonly<Record<string, WorkspaceAppIconAsset>> = {
  vscode: { src: vscodeIconUrl },
  'vscode-insiders': { src: vscodeIconUrl },
  cursor: monochromeIcon(cursorIconUrl),
  windsurf: monochromeIcon(windsurfIconUrl),
  zed: { src: zedIconUrl },
  'sublime-text': { src: sublimeTextIconUrl },
  xcode: { src: xcodeIconUrl },
  'visual-studio': { src: visualStudioIconUrl },
  'android-studio': { src: androidStudioIconUrl },
  'intellij-idea': { src: intellijIdeaIconUrl },
  pycharm: { src: pycharmIconUrl },
  webstorm: { src: webstormIconUrl },
  clion: monochromeIcon(clionIconUrl),
  goland: monochromeIcon(golandIconUrl),
  datagrip: monochromeIcon(datagripIconUrl),
  rider: monochromeIcon(riderIconUrl),
  rubymine: monochromeIcon(rubymineIconUrl),
  phpstorm: monochromeIcon(phpstormIconUrl),
  eclipse: { src: eclipseIconUrl },
  netbeans: { src: netbeansIconUrl },
};
