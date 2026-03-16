$ErrorActionPreference = 'Stop'

Write-Host "[1/3] Installing dependencies..."
npm install

Write-Host "[2/3] ffmpeg component auto-download/resolve..."
Write-Host "If first startup takes longer, wait for ffmpeg component resolution."

Write-Host "[3/3] Starting tray UI bridge on http://127.0.0.1:47890"
npm run start:tray
