# CutStudio

CutStudio is a full-featured, browser-based video editor that runs locally on your machine. It provides a lightweight Non-Linear Editing (NLE) experience similar to Premiere or CapCut, leveraging local file access and a Node.js backend to render fast, high-quality video using FFmpeg.

![CutStudio Interface](installer/assets/icon.png)

## Features

- **Local File Processing:** Edit large video files directly from your hard drive without uploading them to the cloud.
- **Multi-track Timeline:** Support for video, audio, image, and text overlay tracks.
- **Drag & Drop Interface:** Easily add media to your library and drag clips onto the timeline.
- **Clip Manipulation:** Trim, split, move, and edit properties (volume, opacity, timing).
- **Text Overlays:** Add and style text with custom fonts, colors, and animations.
- **Real-time Preview:** Smooth playback and scrubbing using HTML5 Canvas composite rendering.
- **High-Quality Export:** Render final projects to MP4, WEBM, or MOV using a robust FFmpeg backend processor.
- **Project Management:** Save and load project states instantly.

---

## Architecture

CutStudio operates on a hybrid architecture:
1. **Frontend:** A React (Vite) application built with TypeScript, Tailwind CSS, and Zustand for state management.
2. **Backend:** A local Node.js (Express) server that handles heavy lifting: FFmpeg rendering, thumbnail generation, and project saving.
3. **Packaging:** Can be bundled into a standalone Windows desktop application using Electron and NSIS.

## Prerequisites

Before running CutStudio in development mode, ensure you have installed:
- [Node.js](https://nodejs.org/) (v18 or newer recommend)
- `npm` (comes with Node.js)

**Note:** FFmpeg and FFprobe binaries are already included in the `Tools/` directory for Windows.

---

## Development Setup

To run the application locally for development, you need to start both the backend and frontend servers.

### 1. Install Dependencies

First, install the dependencies for both the frontend and backend:

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment

In the `backend/` directory, copy the example environment file:

```bash
cd backend
cp .env.example .env
```
*(You usually won't need to change any defaults in `.env` for local development).*

### 3. Start the Servers

You will need two terminal windows open.

**Terminal 1: Start the Backend**
```bash
cd backend
npm run dev
```
*(Runs on port 3001 by default)*

**Terminal 2: Start the Frontend**
```bash
cd frontend
npm run dev
```
*(Runs on port 5173 by default)*

Open your browser and navigate to `http://localhost:5173`.

---

## Building the Windows Installer

You can package CutStudio into a self-contained Windows `.exe` installer. This bundles the Node.js backend, the built frontend, and FFmpeg into an easy-to-use Electron desktop app that lives in your system tray.

### Steps to Build

1. **Build the Frontend:**
   ```bash
   cd frontend
   npm run build
   ```

2. **Install Electron Dependencies:**
   ```bash
   cd ../installer
   npm install
   ```

3. **Package the Application:**
   ```bash
   npm run build
   ```

The final installer will be located at `installer/dist/CutStudio Setup 1.0.0.exe`.

### Installer Features
- Installs to `C:\Program Files\CutStudio`
- Creates Start Menu and Desktop shortcuts
- Runs quietly in the system tray
- Auto-starts the backend server
- Configurable settings via the tray icon (Port, Temp Folder location, Auto-start behaviors)

---

## Folder Structure

- `/frontend` - React UI codebase.
- `/backend` - Node.js Express server handling FFmpeg jobs and API routes.
- `/installer` - Electron wrapper and NSIS configuration for building the `.exe`.
- `/Tools` - Contains the required `ffmpeg.exe` and `ffprobe.exe` binaries.
- `/TMP` - (Generated at runtime) Local scratch disk for uploads, thumbnails, and renders.

## License

This project is NOT open-source.
