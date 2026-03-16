#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Installing dependencies..."
npm install --omit=dev

echo "[2/3] ffmpeg component will be auto-resolved by npm dependency"

echo "[3/3] Starting local bridge on http://127.0.0.1:47890"
npm start
