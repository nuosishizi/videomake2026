const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeTray', {
  getState: () => ipcRenderer.invoke('tray:get-state'),
  startBridge: () => ipcRenderer.invoke('tray:start-bridge'),
  stopBridge: () => ipcRenderer.invoke('tray:stop-bridge'),
  restartBridge: () => ipcRenderer.invoke('tray:restart-bridge'),
  hideWindow: () => ipcRenderer.invoke('tray:hide-window'),
  showWindow: () => ipcRenderer.invoke('tray:show-window'),
  onState: (handler) => {
    const listener = (_event, state) => handler(state)
    ipcRenderer.on('tray:state-changed', listener)
    return () => ipcRenderer.removeListener('tray:state-changed', listener)
  },
  onLog: (handler) => {
    const listener = (_event, logLine) => handler(logLine)
    ipcRenderer.on('tray:log-line', listener)
    return () => ipcRenderer.removeListener('tray:log-line', listener)
  }
})
