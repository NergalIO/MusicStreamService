import { BrowserWindow, ipcMain, Menu } from 'electron';

/** Wires a frameless window to the renderer's custom caption buttons. */
export function attachWindowState(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized() || win.isFullScreen());
  };
  win.on('maximize', send);
  win.on('unmaximize', send);
  win.on('enter-full-screen', send);
  win.on('leave-full-screen', send);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (!!process.env.ELECTRON_RENDERER_URL && (input.key === 'F5' || (input.control && key === 'r'))) {
      win.webContents.reload();
      event.preventDefault();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

export function registerWindowControls(): void {
  Menu.setApplicationMenu(null);

  const target = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.on('window:minimize', (e) => target(e)?.minimize());
  ipcMain.on('window:toggleMaximize', (e) => {
    const win = target(e);
    if (!win) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (e) => target(e)?.close());
  ipcMain.handle('window:isMaximized', (e) => {
    const win = target(e);
    return !!win && (win.isMaximized() || win.isFullScreen());
  });
}
