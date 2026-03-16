const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

let ffmpegInstaller = null
try {
  ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
} catch {
  ffmpegInstaller = null
}

const DEFAULT_PORT = Number(process.env.PORT || 47890)
const repoRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(os.tmpdir(), 'dsc-bridge')
fs.mkdirSync(tempRoot, { recursive: true })

function nowIso () {
  return new Date().toISOString()
}

function toLogText (value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message || String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function createLogger (logFilePath = '') {
  const filePath = logFilePath ? path.resolve(logFilePath) : ''

  if (filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  function write (level, message) {
    const line = `${nowIso()} [${level}] ${message}`
    console.log(`[bridge] ${line}`)
    if (filePath) {
      try {
        fs.appendFileSync(filePath, `${line}\n`)
      } catch {
        // Ignore logging file errors to avoid affecting main workflow.
      }
    }
  }

  return {
    info: (...args) => write('INFO', args.map(toLogText).join(' ')),
    warn: (...args) => write('WARN', args.map(toLogText).join(' ')),
    error: (...args) => write('ERROR', args.map(toLogText).join(' '))
  }
}

function uniqueList (values) {
  return [...new Set(values.filter(Boolean))]
}

function getInstallerRelativePath () {
  if (process.platform === 'win32') return path.join('win32-x64', 'ffmpeg.exe')
  if (process.platform === 'darwin' && process.arch === 'x64') return path.join('darwin-x64', 'ffmpeg')
  if (process.platform === 'darwin' && process.arch === 'arm64') return path.join('darwin-arm64', 'ffmpeg')
  return ''
}

function resolveFfmpegBin () {
  const strictPackaged = process.env.BRIDGE_STRICT_FFMPEG === '1'
  const logger = createLogger(process.env.BRIDGE_LOG_FILE || '')
  const envBin = process.env.FFMPEG_BIN

  if (envBin && fs.existsSync(envBin)) return envBin

  if (envBin && !fs.existsSync(envBin)) {
    logger.warn(`FFMPEG_BIN path does not exist: ${envBin}`)
    if (strictPackaged) {
      throw new Error(`FFMPEG_BIN path does not exist: ${envBin}`)
    }
  }

  const bundledWin = path.join(repoRoot, 'ffmpeg', 'ffmpeg.exe')
  const bundledUnix = path.join(repoRoot, 'ffmpeg', 'ffmpeg')
  const installerBin = ffmpegInstaller?.path
  const installerRel = getInstallerRelativePath()

  const candidates = []

  if (process.resourcesPath) {
    if (process.platform === 'win32') {
      candidates.push(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'))
    } else {
      candidates.push(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg'))
    }

    if (installerRel) {
      candidates.push(path.join(process.resourcesPath, 'app', 'node_modules', '@ffmpeg-installer', installerRel))
    }
  }

  if (process.platform === 'win32') candidates.push(bundledWin)
  else candidates.push(bundledUnix)

  if (installerBin) candidates.push(installerBin)

  if (installerRel) {
    candidates.push(path.join(__dirname, 'node_modules', '@ffmpeg-installer', installerRel))
    candidates.push(path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', installerRel))
  }

  const found = uniqueList(candidates).find(x => fs.existsSync(x))
  if (found) return found

  if (strictPackaged) {
    throw new Error('Strict ffmpeg packaging is enabled, but no packaged ffmpeg binary was found')
  }

  return envBin || 'ffmpeg'
}

function summarizeFfmpegStderr (text) {
  if (!text) return ''
  const lines = text
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean)

  const tail = lines.slice(-12)
  return tail.join(' | ').slice(0, 1200)
}

function runFfmpegWithArgs (ffmpegBin, args, logger) {
  return new Promise((resolve, reject) => {
    logger.info(`[FFMPEG] ${ffmpegBin} ${args.join(' ')}`)

    const proc = spawn(ffmpegBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''

    proc.stderr.on('data', chunk => {
      stderr += String(chunk)
      if (stderr.length > 100000) {
        stderr = stderr.slice(-100000)
      }
    })

    proc.on('error', err => reject(err))

    proc.on('close', code => {
      if (code === 0) {
        logger.info('[FFMPEG] exit code=0')
        resolve()
        return
      }

      const detail = summarizeFfmpegStderr(stderr)
      logger.error(`[FFMPEG] exit code=${code} detail=${detail}`)
      reject(new Error(`ffmpeg exited with code ${code}. ${detail}`))
    })
  })
}

function buildMp4Args (inputPath, outputPath, videoCodec) {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-fflags', '+genpts',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', videoCodec,
    '-threads', '1',
  ]

  if (videoCodec === 'libx264') {
    args.push(
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '17',
      '-profile:v', 'high',
      '-level:v', '4.2'
    )
  } else if (videoCodec === 'h264') {
    args.push(
      '-pix_fmt', 'yuv420p',
      '-b:v', '14M',
      '-maxrate', '20M',
      '-bufsize', '28M'
    )
  } else {
    args.push(
      '-q:v', '2'
    )
  }

  args.push(
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  )

  return args
}

function buildWebmArgs (inputPath, outputPath) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-fflags', '+genpts',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c', 'copy',
    outputPath
  ]
}

async function runFfmpeg (ffmpegBin, inputPath, outputPath, outputFormat, logger) {
  if (outputFormat === 'webm') {
    await runFfmpegWithArgs(ffmpegBin, buildWebmArgs(inputPath, outputPath), logger)
    return
  }

  // MP4 strategy: fallback across several encoders for higher compatibility.
  const attempts = ['libx264', 'h264', 'mpeg4']
  let lastError = null

  for (const encoder of attempts) {
    try {
      await runFfmpegWithArgs(ffmpegBin, buildMp4Args(inputPath, outputPath, encoder), logger)
      return
    } catch (error) {
      lastError = error
      logger.warn(`[bridge] encoder ${encoder} failed: ${error.message}`)
    }
  }

  throw lastError || new Error('mp4 transcoding failed')
}

function safeUnlink (filePath) {
  if (!filePath) return
  fs.promises.unlink(filePath).catch(() => {})
}

async function createBridgeServer (options = {}) {
  const port = Number(options.port || DEFAULT_PORT)
  const strictPackagedFfmpeg = !!options.strictPackagedFfmpeg
  const logFilePath = options.logFilePath || process.env.BRIDGE_LOG_FILE || ''
  const logger = createLogger(logFilePath)

  if (strictPackagedFfmpeg) {
    process.env.BRIDGE_STRICT_FFMPEG = '1'
  }

  const ffmpegBin = resolveFfmpegBin()
  logger.info(`[BOOT] cwd=${process.cwd()} execPath=${process.execPath} resourcesPath=${process.resourcesPath || 'n/a'}`)
  logger.info(`Using ffmpeg binary: ${ffmpegBin}`)

  const app = express()
  app.use(cors())

  const upload = multer({
    dest: tempRoot,
    limits: {
      fileSize: 1024 * 1024 * 1024
    }
  })

  app.use((req, res, next) => {
    const startedAt = Date.now()
    logger.info(`[HTTP] ${req.method} ${req.originalUrl} start`)

    res.on('finish', () => {
      logger.info(`[HTTP] ${req.method} ${req.originalUrl} done ${res.statusCode} ${Date.now() - startedAt}ms`)
    })

    next()
  })

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      ffmpeg: ffmpegBin,
      ffmpegExists: fs.existsSync(ffmpegBin),
      platform: process.platform,
      pid: process.pid,
      time: nowIso()
    })
  })

  app.post('/transcode', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).send('missing file field')
      return
    }

    const outputFormat = req.body.outputFormat === 'webm' ? 'webm' : 'mp4'
    const ext = outputFormat === 'mp4' ? 'mp4' : 'webm'
    const outputPath = path.join(tempRoot, `${path.parse(req.file.filename).name}_out.${ext}`)

    logger.info(`[TRANSCODE] input=${req.file.path} output=${outputPath} format=${outputFormat} size=${req.file.size || 0}`)

    try {
      await runFfmpeg(ffmpegBin, req.file.path, outputPath, outputFormat, logger)

      const contentType = outputFormat === 'mp4' ? 'video/mp4' : 'video/webm'
      res.setHeader('Content-Type', contentType)
      res.download(outputPath, `output.${ext}`, err => {
        if (err) {
          logger.error('download error', err)
        }
        safeUnlink(req.file.path)
        safeUnlink(outputPath)
      })
    } catch (error) {
      logger.error('transcode failed', error)
      safeUnlink(req.file.path)
      safeUnlink(outputPath)
      res.status(500).send(String(error.message || error))
    }
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const server = app.listen(port, () => {
      settled = true
      logger.info(`Local bridge is running at http://127.0.0.1:${port}`)
      resolve({
        app,
        server,
        port,
        ffmpegBin,
        stop: () => new Promise((resolveStop, rejectStop) => {
          server.close(err => {
            if (err) {
              logger.error('server close failed', err)
              rejectStop(err)
              return
            }
            logger.info('server stopped')
            resolveStop(true)
          })
        })
      })
    })

    server.on('error', err => {
      logger.error('server listen failed', err)
      if (!settled) {
        reject(err)
      }
    })
  })
}

if (require.main === module) {
  createBridgeServer({
    port: DEFAULT_PORT,
    strictPackagedFfmpeg: process.env.BRIDGE_STRICT_FFMPEG === '1',
    logFilePath: process.env.BRIDGE_LOG_FILE || ''
  }).catch(error => {
    console.error('[bridge] fatal startup error:', error)
    process.exit(1)
  })
}

module.exports = {
  createBridgeServer,
  resolveFfmpegBin
}
