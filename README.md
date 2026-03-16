# Dynamic-Subtitle-Composer
A simple and convenient tool for creating dynamic subtitle effects videos. 简单方便的动态字幕效果视频制作工具。

## Local Software Bridge (Native ffmpeg)

This extension now supports an optional local transcoding bridge for stable cross-platform output on Windows/macOS.

### How it works

1. The extension renders subtitles with Canvas + WebCodecs into WebM.
2. If local bridge is enabled, it sends the WebM to your local software service.
3. The service can transcode using native ffmpeg and return MP4/WebM.
4. The extension downloads the returned binary directly.

### UI Settings

- `Enable local software transcoding`
- `Endpoint` (default: `http://127.0.0.1:47890/transcode`)
- `Output format` (`mp4` or `webm`)
- `Timeout seconds`

### HTTP contract

- Method: `POST`
- Content-Type: `multipart/form-data`
- Fields:
	- `file`: input WebM file
	- `outputFormat`: `mp4` or `webm`
	- `batchIndex`: batch task index
- Success response:
	- Status `200`
	- Body: binary video file
	- `Content-Type`: recommended `video/mp4` or `video/webm`
- Failure response:
	- Any non-2xx status with optional text body

### Fallback behavior

If local bridge fails or times out, extension falls back to original WebM output automatically.

## Packaging

- Plugin package: `release/videomake2026-plugin.zip`
- Full source package: `release/videomake2026-full.zip`
- Bridge installer binaries are produced in `release/bridge/`
- Bridge installer bundles: `release/videomake2026-bridge-installer-*.zip`
- Tray installer bundles: `release/videomake2026-bridge-tray-*.zip`

Bridge binary build command:

```bash
cd bridge-server
npm run build:bin:all
```

Bridge tray installer build command:

```bash
cd bridge-server
npm run build:tray:win
```

Tray mode supports hide-to-tray background running and tray right-click exit.

`bridge-server` supports automatic ffmpeg component download through npm dependency `@ffmpeg-installer/ffmpeg` (with explicit override via `FFMPEG_BIN`).

Note: If `pkg` fails to build `macos-arm64` on Windows, run `npm run build:bin:mac:arm64` directly on a macOS host.
