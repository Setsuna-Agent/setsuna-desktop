import { ipcMain } from 'electron';
import type { DesktopTerminalStore } from '../terminal/sessions.js';

export function registerTerminalIpc(terminal: DesktopTerminalStore): void {
  const channels = [
    'terminal:open',
    'terminal:write',
    'terminal:read',
    'terminal:resize',
    'terminal:restart',
    'terminal:close',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('terminal:open', async (_event, input) => terminal.open(input ?? {}));
  ipcMain.handle('terminal:write', async (_event, input) => terminal.write(String(input?.sessionId ?? ''), String(input?.input ?? '')));
  ipcMain.handle('terminal:read', async (_event, input) => terminal.read(String(input?.sessionId ?? '')));
  ipcMain.handle('terminal:resize', async (_event, input) =>
    terminal.resize(String(input?.sessionId ?? ''), Number(input?.cols ?? 100), Number(input?.rows ?? 24)),
  );
  ipcMain.handle('terminal:restart', async (_event, input) =>
    terminal.restart(
      String(input?.sessionId ?? ''),
      typeof input?.cols === 'number' ? input.cols : undefined,
      typeof input?.rows === 'number' ? input.rows : undefined,
    ),
  );
  ipcMain.handle('terminal:close', async (_event, input) => terminal.close(String(input?.sessionId ?? '')));
}
