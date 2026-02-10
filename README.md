# Lightweight Windows Log Reader (Bun + React)

A lightweight log reader designed for Windows Server environments. The backend is built with Bun, and a local React SPA is served in your browser. It avoids Electron, focuses on fast startup, and keeps the UI optimized for RDP workflows.

## Features

- **Three-pane layout**: Sources → Files → Viewer
- **Tail + follow** with low-latency streaming (SSE)
- **Jump to end**, wrap toggle, font size controls
- **In-view search highlighting** + backend search (streamed results)
- **Copy selected lines** and **Copy match** buttons
- **Bookmarks** for quick line marking
- **Per-file filter** for quickly narrowing visible lines
- **Log level highlighting** (ERROR/WARN/INFO/DEBUG)
- **Efficient large file handling** (loads last N lines only)

## Hardcoded log sources (config later)

- IIS Logs: `C:\inetpub\logs\LogFiles\**\*.log`
- App Logs: `D:\apps\myapp\logs\**\*.log`
- Windows Event Export: `C:\Logs\EventExport\**\*.txt`

Update `server/logSources.ts` to add or change sources.

## Folder structure

```
server/               # Bun HTTP server, log scanning, tailing, search
  index.ts            # Entry point and API routes
  fileScanner.ts      # Recursive file discovery
  logSources.ts       # Hardcoded sources
  search.ts           # Streaming search (SSE)
  tail.ts             # Tail + rotation handling (SSE)
  utils.ts            # Glob helpers
web/                  # React UI
  index.html
  src/
    App.tsx
    main.tsx
    styles.css
```

## Key endpoints

- `GET /api/sources` → list of log sources
- `GET /api/files?sourceId=...` → discovered files
- `POST /api/refresh` → rescan a source
- `GET /api/lines?path=...&lines=2000` → last N lines
- `GET /api/tail?path=...&lines=2000` → SSE stream of appended lines
- `GET /api/search?path=...&q=...&case=false&regex=false` → SSE stream of matches

## Setup

```bash
bun install
bun --cwd web install
```

## Run (dev)

Start the Bun server (API + static UI):

```bash
bun run dev
```

Build the web UI and run locally:

```bash
bun run build:web
bun run start
```

The server prints a local URL, e.g. `http://localhost:3210`.

## Build a Windows executable

```bash
bun run build:web
bun run build:exe
```

This produces `dist/log-reader.exe`. Place `web/dist` alongside the executable (same folder) so static assets are served at runtime.

## Manual test plan

1. Run `bun run dev` and open the printed URL.
2. Select a source, confirm files load and sorting is newest-first.
3. Open a file; verify last lines appear and follow/tail updates on file append.
4. Toggle wrap, font size, jump-to-end, and pause/follow.
5. Search in-view and run backend search; verify streamed results appear.
6. Copy selected lines and copy match; verify clipboard contents.
