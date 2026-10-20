import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const root = process.argv[2];
app.setPath('userData', path.join(root, 'profile'));
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  try {
    await window.loadFile(path.join(root, 'index.html'));
    console.log(await window.webContents.executeJavaScript('runComposerEditingChecks()'));
  } finally {
    window.destroy();
  }
}

void main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
