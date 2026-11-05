import { contextBridge, ipcRenderer } from 'electron';
import './plugin-ui-page.preload.js';

contextBridge.exposeInMainWorld('requestReactAppFixture', (path: string, body?: unknown) => (
  ipcRenderer.invoke('setsuna-test:react-app-request', path, body)
));
