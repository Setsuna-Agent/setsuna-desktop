import androidStudioIconUrl from '../../assets/workspace-apps/android-studio.svg';
import clionIconUrl from '../../assets/workspace-apps/clion.svg';
import cursorIconUrl from '../../assets/workspace-apps/cursor.svg';
import datagripIconUrl from '../../assets/workspace-apps/datagrip.svg';
import eclipseIconUrl from '../../assets/workspace-apps/eclipse.svg';
import golandIconUrl from '../../assets/workspace-apps/goland.svg';
import intellijIdeaIconUrl from '../../assets/workspace-apps/intellij-idea.svg';
import netbeansIconUrl from '../../assets/workspace-apps/netbeans.svg';
import phpstormIconUrl from '../../assets/workspace-apps/phpstorm.svg';
import pycharmIconUrl from '../../assets/workspace-apps/pycharm.svg';
import riderIconUrl from '../../assets/workspace-apps/rider.svg';
import rubymineIconUrl from '../../assets/workspace-apps/rubymine.svg';
import sublimeTextIconUrl from '../../assets/workspace-apps/sublime-text.svg';
import visualStudioIconUrl from '../../assets/workspace-apps/visual-studio.svg';
import vscodeIconUrl from '../../assets/workspace-apps/vscode.svg';
import webstormIconUrl from '../../assets/workspace-apps/webstorm.svg';
import windsurfIconUrl from '../../assets/workspace-apps/windsurf.svg';
import xcodeIconUrl from '../../assets/workspace-apps/xcode.svg';
import zedIconUrl from '../../assets/workspace-apps/zed.svg';

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
