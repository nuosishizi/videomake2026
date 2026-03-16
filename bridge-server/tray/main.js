const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')
const http = require('http')
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require('electron')

const BRIDGE_PORT = Number(process.env.PORT || 47890)
const HEALTH_URL = `http://127.0.0.1:${BRIDGE_PORT}/health`

let tray = null
let win = null
let bridgeProc = null
let quitRequested = false
let healthTimer = null

const state = {
  running: false,
  health: null,
  lastError: ''
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
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('tray:log-line', line)
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

function startBridgeProcess () {
  if (bridgeProc) {
    pushLog('Bridge 已在运行，忽略重复启动')
    return
  }

  const serverEntry = path.join(__dirname, '..', 'server.js')
  bridgeProc = fork(serverEntry, [], {
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    silent: true,
    execArgv: []
  })

  bridgeProc.stdout.on('data', chunk => {
    const txt = String(chunk).trim()
    if (!txt) return
    txt.split(/\r?\n/).forEach(line => pushLog(line))
  })

  bridgeProc.stderr.on('data', chunk => {
    const txt = String(chunk).trim()
    if (!txt) return
    txt.split(/\r?\n/).forEach(line => pushLog(`ERR: ${line}`))
    state.lastError = txt
  })

  bridgeProc.on('exit', code => {
    pushLog(`Bridge 进程退出，code=${code}`)
    bridgeProc = null
    state.running = false
    if (!quitRequested) {
      state.lastError = state.lastError || `Bridge 退出 code=${code}`
    }
    broadcastState()
  })

  state.running = true
  state.lastError = ''
  pushLog('Bridge 进程已启动')
  broadcastState()
}

function stopBridgeProcess () {
  if (!bridgeProc) return
  pushLog('正在停止 Bridge 进程...')
  bridgeProc.kill()
}

function restartBridgeProcess () {
  stopBridgeProcess()
  setTimeout(() => {
    startBridgeProcess()
  }, 500)
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
          if (state.running) restartBridgeProcess()
          else startBridgeProcess()
        }
      },
      {
        label: '停止服务',
        enabled: state.running,
        click: () => stopBridgeProcess()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitRequested = true
          stopBridgeProcess()
          setTimeout(() => app.quit(), 300)
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
  startBridgeProcess()
  return true
})

ipcMain.handle('tray:stop-bridge', () => {
  stopBridgeProcess()
  return true
})

ipcMain.handle('tray:restart-bridge', () => {
  restartBridgeProcess()
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
  createWindow()
  createTray()
  beginHealthMonitor()
  startBridgeProcess()
})

app.on('before-quit', () => {
  quitRequested = true
  stopHealthMonitor()
  stopBridgeProcess()
})

app.on('window-all-closed', event => {
  if (!quitRequested) {
    event.preventDefault()
  }
})
