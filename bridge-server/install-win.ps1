$ErrorActionPreference = 'Stop'

Write-Host "[1/3] Installing dependencies..."
npm install --omit=dev

Write-Host "[2/3] Verifying bridge health startup..."
Write-Host "If first startup takes longer, wait for ffmpeg component resolution."

Write-Host "[3/3] Starting local bridge on http://127.0.0.1:47890"
npm start
