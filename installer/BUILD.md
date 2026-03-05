# CutStudio — Building the Windows Installer

## Prerequisites

| Tool | Where to get |
|---|---|
| Node.js ≥ 18 | https://nodejs.org |
| npm ≥ 9 | (comes with Node) |
| FFmpeg + FFprobe | Already in `/Tools/` |

---

## Step 1 — Build the React frontend

```powershell
cd frontend
npm run build        # outputs to frontend/dist/
```

---

## Step 2 — Install installer dependencies

```powershell
cd installer
npm install
```

---

## Step 3 — Test locally (no installer, runs Electron directly)

```powershell
cd installer
npm start
```

A tray icon appears in the system tray. Double-click to open the editor.

---

## Step 4 — Build the Windows installer

```powershell
cd installer
npm run build
```

Output: `installer/dist/CutStudio Setup 1.0.0.exe`

---

## What the installer does

1. Runs a standard wizard (Next → choose install dir → Install → Finish)
2. Copies all files to the chosen directory (default `C:\Program Files\CutStudio`)
3. Includes: Electron app, backend, frontend, FFmpeg, FFprobe
4. Creates Start Menu shortcut
5. Creates Desktop shortcut (optional)
6. Registers in **Add / Remove Programs** → uninstall from there

---

## First run

After installation the app launches automatically.  
A **Settings** window appears on first run — confirm the port (default 3001)  
and TMP folder, then click **Save & Apply**.  
The server starts and the editor opens in your default browser at `http://localhost:3001`.

---

## Startup behaviour

- The app registers itself to start at Windows login (can be toggled in Settings)
- The tray icon appears in the system tray (bottom-right)
- **Double-click** tray icon → opens editor in browser
- **Right-click** tray icon → Start / Stop / Settings / Quit

---

## Changing Settings

Right-click tray icon → **Settings…**

| Setting | Description |
|---|---|
| Port | Port the server listens on (restart required) |
| TMP Folder | Where uploads, thumbnails and renders are stored |
| Auto-start server | Start backend when app opens |
| Open in browser | Open editor tab when server starts |
| Launch at login | Register in Windows startup |

---

## Uninstalling

`Control Panel → Programs → Programs and Features → CutStudio → Uninstall`

Or: `Settings → Apps → CutStudio → Uninstall`

The uninstaller removes all app files. TMP files in the chosen TMP folder  
are **not** deleted automatically (your renders are safe).

---

## File structure after install

```
<Install Dir>/
  CutStudio.exe
  resources/
    backend/       ← Node.js backend + node_modules
    frontend/      ← Built React app (served by backend)
    Tools/         ← ffmpeg.exe, ffprobe.exe

%APPDATA%\CutStudio\
  settings.json    ← user settings
  TMP/             ← default TMP folder (uploads, renders, …)
```
