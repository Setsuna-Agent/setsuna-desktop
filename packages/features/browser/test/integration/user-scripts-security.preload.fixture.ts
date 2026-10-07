import { ipcRenderer } from 'electron';
import { USER_SCRIPTS_CHANNELS } from '../../src/contracts/user-scripts.js';

// Acknowledge only after the real runner handled the event, so loading-page tests
// can release their parser barrier without relying on arbitrary timer delays.
if (typeof document === 'object' && /^https?:/.test(location.href)) ipcRenderer.send('fixture:user-scripts-planned');
ipcRenderer.on(USER_SCRIPTS_CHANNELS.invalidate, (_event, value) => ipcRenderer.send('fixture:user-scripts-invalidated', value));
ipcRenderer.on(USER_SCRIPTS_CHANNELS.execute, (_event, value) => ipcRenderer.send('fixture:user-scripts-execution', value));
