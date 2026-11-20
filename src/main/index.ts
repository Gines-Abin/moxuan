import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, type Event } from 'electron';
import { EventLogWriter } from './eventLog';
import { registerIpc } from './ipc';
import { StorageRepository } from './storage';

const singleInstance = app.requestSingleInstanceLock();
const pendingFlushes = new Set<number>();
let mainWindow: BrowserWindow | null = null;
let disposeIpc: (() => void) | undefined;
let flushing = false;
let flushComplete = false;

function handleFlushComplete(webContentsId: number, saved: boolean): void {
  if (!flushing || !pendingFlushes.has(webContentsId)) return;
  if (!saved) {
    flushing = false;
    pendingFlushes.clear();
    return;
  }
  pendingFlushes.delete(webContentsId);
  if (pendingFlushes.size > 0) return;
  flushComplete = true;
  setImmediate(() => app.quit());
}

function requestQuit(event: Event): void {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (flushComplete || windows.length === 0) return;
  event.preventDefault();
  if (flushing) return;
  flushing = true;
  pendingFlushes.clear();
  for (const window of windows) {
    pendingFlushes.add(window.webContents.id);
    window.webContents.send('app:before-quit');
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && targetUrl !== currentUrl) event.preventDefault();
  });
  window.on('close', requestQuit);
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

/** 解析数据目录：优先使用环境变量；否则迁移旧品牌目录到新目录。 */
function resolveDataDirectory(): string {
  const configured = process.env.INKFORGE_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const target = path.join(app.getPath('documents'), '墨轩');
  const legacy = path.join(app.getPath('documents'), '墨枢 InkForge');
  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, target);
    } catch {
      try {
        fs.cpSync(legacy, target, { recursive: true });
      } catch {
        return legacy;
      }
    }
  }
  return target;
}

if (!singleInstance) {  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const dataDirectory = resolveDataDirectory();
    const storage = new StorageRepository(dataDirectory);
    await storage.initialize();
    const events = new EventLogWriter(dataDirectory);
    disposeIpc = registerIpc({
      storage, events, version: app.getVersion(), dataDirectory, onFlushComplete: handleFlushComplete,
    });
    mainWindow = createWindow();
    events.write('app_ready', { platform: process.platform });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  }).catch(() => {
    app.exit(1);
  });

  app.on('before-quit', requestQuit);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => disposeIpc?.());
}
