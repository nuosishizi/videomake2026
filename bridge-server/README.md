# Local Bridge Server (Windows/macOS)

This server provides a local software interface for the extension.

## 1) Install ffmpeg

Make sure native ffmpeg is available in PATH.

- Windows: install ffmpeg and ensure `ffmpeg -version` works in terminal.
- macOS: install via Homebrew (`brew install ffmpeg`) or your preferred method.

## 2) Install dependencies

```bash
npm install
```

## 3) Start server

```bash
npm start
```

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
