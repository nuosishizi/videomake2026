# Local Bridge Server (Windows/macOS)

This server provides a local software interface for the extension.

## 1) ffmpeg strategy (auto download first)

After `npm install`, package `@ffmpeg-installer/ffmpeg` will automatically download a platform-specific ffmpeg binary.

Priority order used by server:

1. `FFMPEG_BIN` environment variable (explicit override)
2. Repository bundled binary (`../ffmpeg/ffmpeg.exe` or `../ffmpeg/ffmpeg`)
3. Auto-downloaded binary from `@ffmpeg-installer/ffmpeg`
4. `ffmpeg` in system PATH (fallback)

If you still prefer manual ffmpeg:

Make sure native ffmpeg is available in PATH.

- Windows: install ffmpeg and ensure `ffmpeg -version` works in terminal.
- macOS: install via Homebrew (`brew install ffmpeg`) or your preferred method.

## 2) Install dependencies

```bash
npm install
```

## 3) Start service

```bash
npm start
```

## 4) Start tray UI (recommended)

```bash
npm run start:tray
```

Tray behavior:

- Close window: hide to tray, service continues in background
- Tray right-click menu: show panel / start-stop / restart / exit
- To fully exit: use tray menu `退出`

## Build installer binaries (Windows/macOS)

```bash
npm run build:bin:all
```

Artifacts will be generated under `../release/bridge/`:

- `dsc-bridge-win-x64.exe`
- `dsc-bridge-macos-x64`
- `dsc-bridge-macos-arm64`

## Build tray installer packages

Windows installer package:

```bash
npm run build:tray:win
```

macOS zip app package (run on macOS):

```bash
npm run build:tray:mac
```

If building on Windows and `macos-arm64` fails in `pkg`, run this on a macOS machine:

```bash
npm run build:bin:mac:arm64
```

## Installer scripts

- Windows one-command install/start: `install-win.ps1`
- macOS one-command install/start: `install-mac.sh`
- Quick start scripts: `start-win.bat`, `start-mac.command`

These scripts now default to tray mode (`npm run start:tray`).

Default endpoint:

- `http://127.0.0.1:47890/transcode`
- health check: `http://127.0.0.1:47890/health`

## Optional env vars

- `PORT`: default `47890`
- `FFMPEG_BIN`: ffmpeg executable path, default `ffmpeg`

Examples:

```bash
PORT=5000 npm start
```

```bash
FFMPEG_BIN=/usr/local/bin/ffmpeg npm start
```

On Windows PowerShell:

```powershell
$env:PORT=5000; npm start
```

```powershell
$env:FFMPEG_BIN='C:\\ffmpeg\\bin\\ffmpeg.exe'; npm start
```
