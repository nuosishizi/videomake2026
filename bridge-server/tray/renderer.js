const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const ffmpegEl = document.getElementById('ffmpeg')
const platformEl = document.getElementById('platform')
const lastErrorEl = document.getElementById('lastError')
const logsEl = document.getElementById('logs')

const startBtn = document.getElementById('startBtn')
const stopBtn = document.getElementById('stopBtn')
const restartBtn = document.getElementById('restartBtn')
const hideBtn = document.getElementById('hideBtn')

function setStatus (state) {
  const running = !!state?.running
  const hasError = !!state?.lastError

  statusDot.classList.remove('running', 'error')
  if (running) statusDot.classList.add('running')
  if (hasError && !running) statusDot.classList.add('error')

  statusText.textContent = running ? '运行中' : (hasError ? '异常停止' : '已停止')
  ffmpegEl.textContent = state?.health?.ffmpeg || '未检测到'
  platformEl.textContent = state?.health?.platform || navigator.platform
  lastErrorEl.textContent = state?.lastError || '无'

  startBtn.disabled = running
  stopBtn.disabled = !running
}

function pushLog (line) {
  const ts = new Date().toLocaleTimeString()
  logsEl.textContent += `[${ts}] ${line}\n`
  logsEl.scrollTop = logsEl.scrollHeight
}

startBtn.addEventListener('click', () => window.bridgeTray.startBridge())
stopBtn.addEventListener('click', () => window.bridgeTray.stopBridge())
restartBtn.addEventListener('click', () => window.bridgeTray.restartBridge())
hideBtn.addEventListener('click', () => window.bridgeTray.hideWindow())

window.bridgeTray.onState(setStatus)
window.bridgeTray.onLog(pushLog)

window.bridgeTray.getState().then(state => {
  setStatus(state)
  pushLog('控制台已连接')
}).catch(err => {
  pushLog(`初始化失败: ${err?.message || err}`)
})
