const path = require('path')
const fs = require('fs')
const http = require('http')
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require('electron')
const { createBridgeServer } = require('../server')

const BRIDGE_PORT = Number(process.env.PORT || 47890)
const HEALTH_URL = `http://127.0.0.1:${BRIDGE_PORT}/health`

let tray = null
let win = null
let bridgeRuntime = null
let quitRequested = false
let healthTimer = null
let trayLogFile = ''

const state = {
  running: false,
  health: null,
  lastError: ''
}

function nowIso () {
  return new Date().toISOString()
}

function initLogPaths () {
  const logDir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  trayLogFile = path.join(logDir, 'tray.log')
  if (!process.env.BRIDGE_LOG_FILE) {
    process.env.BRIDGE_LOG_FILE = path.join(logDir, 'bridge.log')
  }
}

function broadcastState () {
  const payload = {
    running: state.running,
    health: state.health,
    lastError: state.lastError
  }

  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('tray:state-changed', payload)
  })

  if (tray) {
    const tip = state.running ? `DSC Bridge 运行中 :${BRIDGE_PORT}` : `DSC Bridge 已停止 :${BRIDGE_PORT}`
    tray.setToolTip(tip)
  }
}

function pushLog (line) {
  const text = `${nowIso()} ${line}`
  console.log(`[tray] ${text}`)

  if (trayLogFile) {
    try {
      fs.appendFileSync(trayLogFile, `${text}\n`)
    } catch {
      // Ignore file logging errors to avoid breaking the app.
    }
  }

  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('tray:log-line', text)
  })
}

function showMainWindow () {
  if (!win) return
  win.show()
  win.focus()
}

function hideMainWindow () {
  if (!win) return
  win.hide()
}

function fetchHealth () {
  return new Promise(resolve => {
    const req = http.get(HEALTH_URL, { timeout: 2000 }, res => {
      let body = ''
      res.on('data', c => { body += String(c) })
      res.on('end', () => {
        try {
          const json = JSON.parse(body || '{}')
          resolve({ ok: true, json })
        } catch {
          resolve({ ok: false, error: 'health JSON parse failed' })
        }
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error('health timeout'))
    })

    req.on('error', err => {
      resolve({ ok: false, error: err.message })
    })
  })
}

function beginHealthMonitor () {
  if (healthTimer) return

  healthTimer = setInterval(async () => {
    const result = await fetchHealth()
    if (result.ok) {
      state.health = result.json
      if (state.running) state.lastError = ''
      broadcastState()
      return
    }

    if (state.running) {
      state.lastError = `健康检查失败: ${result.error}`
      broadcastState()
    }
  }, 2000)
}

function stopHealthMonitor () {
  if (!healthTimer) return
  clearInterval(healthTimer)
  healthTimer = null
}

async function startBridgeProcess () {
  if (bridgeRuntime) {
    pushLog('Bridge 已在运行，忽略重复启动')
    return
  }

  try {
    pushLog(`启动 Bridge 服务 (isPackaged=${app.isPackaged}, resourcesPath=${process.resourcesPath || 'n/a'})`)

    process.env.BRIDGE_STRICT_FFMPEG = '1'

    bridgeRuntime = await createBridgeServer({
      port: BRIDGE_PORT,
      strictPackagedFfmpeg: true,
      logFilePath: process.env.BRIDGE_LOG_FILE
    })

    state.running = true
    state.lastError = ''
    state.health = {
      ok: true,
      ffmpeg: bridgeRuntime.ffmpegBin,
      ffmpegExists: fs.existsSync(bridgeRuntime.ffmpegBin),
      platform: process.platform,
      pid: process.pid
    }

    pushLog(`Bridge 服务已启动，FFmpeg=${bridgeRuntime.ffmpegBin}`)
    broadcastState()
  } catch (error) {
    state.running = false
    state.lastError = `启动失败: ${error.message}`
    state.health = null
    pushLog(`ERR: ${state.lastError}`)
    broadcastState()
  }
}

async function stopBridgeProcess () {
  if (!bridgeRuntime) {
    state.running = false
    broadcastState()
    return
  }

  pushLog('正在停止 Bridge 服务...')
  try {
    await bridgeRuntime.stop()
    pushLog('Bridge 服务已停止')
  } catch (error) {
    state.lastError = `停止失败: ${error.message}`
    pushLog(`ERR: ${state.lastError}`)
  } finally {
    bridgeRuntime = null
    state.running = false
    broadcastState()
  }
}

async function restartBridgeProcess () {
  await stopBridgeProcess()
  await startBridgeProcess()
}

function runSafely (fn) {
  Promise.resolve(fn()).catch(error => {
    state.lastError = `运行异常: ${error.message}`
    pushLog(`ERR: ${state.lastError}`)
    broadcastState()
  })
}

function createTray () {
  const packagedIcon = path.join(process.resourcesPath, 'icon.png')
  const devIcon = path.join(__dirname, '..', '..', 'icon.png')
  const iconPath = fs.existsSync(packagedIcon) ? packagedIcon : devIcon
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image)

  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: '显示面板',
        click: () => {
          showMainWindow()
        }
      },
      {
        label: state.running ? '重启服务' : '启动服务',
        click: () => {
          if (state.running) runSafely(() => restartBridgeProcess())
          else runSafely(() => startBridgeProcess())
        }
      },
      {
        label: '停止服务',
        enabled: state.running,
        click: () => runSafely(() => stopBridgeProcess())
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitRequested = true
          runSafely(async () => {
            await stopBridgeProcess()
            setTimeout(() => app.quit(), 150)
          })
        }
      }
    ])

    tray.setContextMenu(menu)
  }

  tray.on('click', () => {
    if (!win) return
    if (win.isVisible()) hideMainWindow()
    else showMainWindow()
  })

  // Rebuild menu every second to keep enabled states in sync.
  setInterval(rebuildMenu, 1000)
  rebuildMenu()
  broadcastState()
}

function createWindow () {
  win = new BrowserWindow({
    width: 680,
    height: 560,
    minWidth: 620,
    minHeight: 500,
    show: true,
    title: 'DSC Bridge 控制台',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile(path.join(__dirname, 'index.html'))

  win.on('close', event => {
    if (quitRequested) return
    event.preventDefault()
    win.hide()
    pushLog('窗口已隐藏到托盘，服务继续后台运行')
  })
}

ipcMain.handle('tray:get-state', () => ({
  running: state.running,
  health: state.health,
  lastError: state.lastError
}))

ipcMain.handle('tray:start-bridge', () => {
  runSafely(() => startBridgeProcess())
  return true
})

ipcMain.handle('tray:stop-bridge', () => {
  runSafely(() => stopBridgeProcess())
  return true
})

ipcMain.handle('tray:restart-bridge', () => {
  runSafely(() => restartBridgeProcess())
  return true
})

ipcMain.handle('tray:show-window', () => {
  showMainWindow()
  return true
})

ipcMain.handle('tray:hide-window', () => {
  hideMainWindow()
  return true
})

app.whenReady().then(() => {
  initLogPaths()
  pushLog('托盘程序启动')
  createWindow()
  createTray()
  beginHealthMonitor()
  runSafely(() => startBridgeProcess())
})

app.on('before-quit', () => {
  quitRequested = true
  stopHealthMonitor()
  runSafely(() => stopBridgeProcess())
})

app.on('window-all-closed', event => {
  if (!quitRequested) {
    event.preventDefault()
  }
})
