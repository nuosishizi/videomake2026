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

const app = express()
const PORT = Number(process.env.PORT || 47890)
const repoRoot = path.resolve(__dirname, '..')

function resolveFfmpegBin () {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN

  const bundledWin = path.join(repoRoot, 'ffmpeg', 'ffmpeg.exe')
  const bundledUnix = path.join(repoRoot, 'ffmpeg', 'ffmpeg')
  const installerBin = ffmpegInstaller?.path

  if (process.platform === 'win32' && fs.existsSync(bundledWin)) return bundledWin
  if (fs.existsSync(bundledUnix)) return bundledUnix
  if (installerBin && fs.existsSync(installerBin)) return installerBin

  return 'ffmpeg'
}

const FFMPEG_BIN = resolveFfmpegBin()

app.use(cors())

const tempRoot = path.join(os.tmpdir(), 'dsc-bridge')
fs.mkdirSync(tempRoot, { recursive: true })

const upload = multer({
  dest: tempRoot,
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
})

function summarizeFfmpegStderr (text) {
  if (!text) return ''
  const lines = text
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean)

  const tail = lines.slice(-12)
  return tail.join(' | ').slice(0, 1200)
}

function runFfmpegWithArgs (args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, {
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
        resolve()
        return
      }

      const detail = summarizeFfmpegStderr(stderr)
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

async function runFfmpeg (inputPath, outputPath, outputFormat) {
  if (outputFormat === 'webm') {
    await runFfmpegWithArgs(buildWebmArgs(inputPath, outputPath))
    return
  }

  // MP4 strategy: fallback across several encoders for higher compatibility.
  const attempts = ['libx264', 'h264', 'mpeg4']
  let lastError = null

  for (const encoder of attempts) {
    try {
      await runFfmpegWithArgs(buildMp4Args(inputPath, outputPath, encoder))
      return
    } catch (error) {
      lastError = error
      console.warn(`[bridge] encoder ${encoder} failed: ${error.message}`)
    }
  }

  throw lastError || new Error('mp4 transcoding failed')
}

function safeUnlink (filePath) {
  if (!filePath) return
  fs.promises.unlink(filePath).catch(() => {})
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ffmpeg: FFMPEG_BIN,
    ffmpegExists: fs.existsSync(FFMPEG_BIN),
    platform: process.platform
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

  try {
    await runFfmpeg(req.file.path, outputPath, outputFormat)

    const contentType = outputFormat === 'mp4' ? 'video/mp4' : 'video/webm'
    res.setHeader('Content-Type', contentType)
    res.download(outputPath, `output.${ext}`, err => {
      if (err) {
        console.error('download error:', err)
      }
      safeUnlink(req.file.path)
      safeUnlink(outputPath)
    })
  } catch (error) {
    console.error('transcode failed:', error)
    safeUnlink(req.file.path)
    safeUnlink(outputPath)
    res.status(500).send(String(error.message || error))
  }
})

app.listen(PORT, () => {
  console.log(`Local bridge is running at http://127.0.0.1:${PORT}`)
  console.log(`Using ffmpeg binary: ${FFMPEG_BIN}`)
})
