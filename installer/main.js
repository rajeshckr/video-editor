'use strict';

// ─── Imports (no Electron API calls here) ────────────────────────────────────
const electron = require('electron');
const path     = require('path');
const fs       = require('fs');

// Destructure AFTER import — Electron APIs not called yet, just referenced
const { app, Tray, Menu, BrowserWindow, dialog, ipcMain, shell, nativeImage, utilityProcess } = electron;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isDev()  { return !app.isPackaged; }

function resourcePath(...p) {
  return isDev()
    ? path.join(__dirname, '..', ...p)
    : path.join(process.resourcesPath, ...p);
}

function getToolsPath() {
  return isDev()
    ? path.join(__dirname, '..', 'Tools')
    : path.join(process.resourcesPath, 'Tools');
}

// ─── Settings (all app.* calls deferred to runtime) ──────────────────────────
function settingsFile()  { return path.join(app.getPath('userData'), 'settings.json'); }
function defaultTmpPath(){ return path.join(app.getPath('userData'), 'TMP'); }

function defaultSettings() {
  return { port: 3001, tmpPath: defaultTmpPath(), autoStartServer: true, openOnStart: true, firstRun: true };
}

function loadSettings() {
  try {
    const f = settingsFile();
    if (fs.existsSync(f)) return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch (_) {}
  return defaultSettings();
}

function saveSettings(s) {
  const f = settingsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
}

function ensureTmpDirs(tmpPath) {
  ['uploads','thumbnails','intermediate','audio','renders','cache']
    .forEach(d => fs.mkdirSync(path.join(tmpPath, d), { recursive: true }));
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────
let serverProc = null;
let tray       = null;

function startServer(settings) {
  if (serverProc) return false;
  const script = resourcePath('backend', 'server.js');
  if (!fs.existsSync(script)) { dialog.showErrorBox('CutStudio', `Backend not found:\n${script}`); return false; }
  ensureTmpDirs(settings.tmpPath);
  serverProc = utilityProcess.fork(script, [], {
    env: { ...process.env, PORT: String(settings.port), TMP_PATH: settings.tmpPath, TOOLS_PATH: getToolsPath(), FRONTEND_URL: `http://localhost:${settings.port}` },
    stdio: 'pipe',
  });
  serverProc.stdout?.on('data', d => process.stdout.write('[Server] ' + d));
  serverProc.stderr?.on('data', d => process.stderr.write('[Server!] ' + d));
  serverProc.on('exit', () => { serverProc = null; rebuildTray(false); });
  rebuildTray(true);
  return true;
}

function stopServer() {
  if (!serverProc) return;
  serverProc.kill(); serverProc = null; rebuildTray(false);
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function rebuildTray(running) {
  if (!tray) return;
  const s = loadSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'CutStudio', enabled: false },
    { label: running ? `● Port ${s.port}` : '○ Stopped', enabled: false },
    { type: 'separator' },
    { label: running ? 'Stop Server' : 'Start Server', click: () => {
        if (running) stopServer();
        else { const c = loadSettings(); if (startServer(c) && c.openOnStart) setTimeout(() => shell.openExternal(`http://localhost:${c.port}`), 1500); }
    }},
    { label: 'Open in Browser', enabled: running, click: () => shell.openExternal(`http://localhost:${s.port}`) },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => { stopServer(); app.quit(); } },
  ]));
  tray.setToolTip(running ? `CutStudio — port ${s.port}` : 'CutStudio — stopped');
}

// ─── Settings window ──────────────────────────────────────────────────────────
let settingsWin = null;
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 480, height: 440, resizable: false, maximizable: false,
    title: 'CutStudio Settings', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.setAppUserModelId('com.cutstudio.app');
  app.on('window-all-closed', e => e.preventDefault()); // stay in tray

  // Register IPC handlers (must be inside whenReady or after)
  ipcMain.handle('get-settings',  ()         => loadSettings());
  ipcMain.handle('server-status', ()         => !!serverProc);
  ipcMain.handle('start-server',  ()         => startServer(loadSettings()));
  ipcMain.handle('stop-server',   ()         => { stopServer(); return true; });
  ipcMain.handle('pick-folder',   async ()   => {
    const r = await dialog.showOpenDialog(settingsWin, { properties: ['openDirectory','createDirectory'], title: 'Choose TMP Folder' });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('save-settings', (_e, s) => {
    const prev = loadSettings();
    const next = { ...prev, ...s, firstRun: false };
    saveSettings(next);
    app.setLoginItemSettings({ openAtLogin: next.autoStartServer });
    const needsRestart = serverProc && (next.port !== prev.port || next.tmpPath !== prev.tmpPath);
    if (needsRestart) { stopServer(); setTimeout(() => startServer(next), 800); }
    return { success: true, restarted: !!needsRestart };
  });

  // Create tray
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('CutStudio');
  rebuildTray(false);
  tray.on('double-click', () => {
    const s = loadSettings();
    if (serverProc) shell.openExternal(`http://localhost:${s.port}`);
    else openSettings();
  });

  // First run or auto-start
  const settings = loadSettings();
  if (settings.firstRun) {
    openSettings();
    saveSettings({ ...settings, firstRun: false });
  } else if (settings.autoStartServer) {
    startServer(settings);
    if (settings.openOnStart) setTimeout(() => shell.openExternal(`http://localhost:${settings.port}`), 1500);
  }
  app.setLoginItemSettings({ openAtLogin: settings.autoStartServer });
});

app.on('before-quit', stopServer);
