import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}

let pythonProcess: ChildProcessWithoutNullStreams | null = null
let buffer = ''
const pendingQueue: PendingRequest[] = []
let restartAttempts = 0
const MAX_RESTART_ATTEMPTS = 3

/** Default for quick commands (health, ingest, thumbnail, detectSilence). */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

/**
 * Transcription (faster-whisper), SBERT matching, and full FFmpeg export can run many
 * minutes on CPU — a single global short timeout falsely reports "stuck" for normal work.
 */
export const LONG_ENGINE_TIMEOUT_MS = 45 * 60 * 1000

export type SendToEngineOptions = {
  timeoutMs?: number
}

function getPythonPath(): string {
  return 'python'
}

function getEnginePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'engine')
  }
  return join(app.getAppPath(), 'engine')
}

export function startPythonEngine(): void {
  if (pythonProcess) return

  const engineDir = getEnginePath()
  pythonProcess = spawn(getPythonPath(), ['-u', '-m', 'engine.main'], {
    cwd: join(engineDir, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  pythonProcess.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed: unknown = JSON.parse(trimmed)
        const pending = pendingQueue.shift()
        if (pending) {
          clearTimeout(pending.timeoutId)
          pending.resolve(parsed)
        }
      } catch {
        console.error('[pythonBridge] Bad JSON from engine:', trimmed)
      }
    }
  })

  pythonProcess.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim()
    if (msg) console.error('[pythonBridge] stderr:', msg)
  })

  pythonProcess.on('exit', (code) => {
    console.log(`[pythonBridge] Python process exited with code ${code}`)
    pythonProcess = null

    while (pendingQueue.length) {
      const p = pendingQueue.shift()
      if (p) {
        clearTimeout(p.timeoutId)
        p.reject(new Error(`Engine process exited unexpectedly (code ${code}). Check that Python and dependencies are installed.`))
      }
    }

    if (restartAttempts < MAX_RESTART_ATTEMPTS) {
      restartAttempts++
      console.log(`[pythonBridge] Auto-restart attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}...`)
      setTimeout(() => startPythonEngine(), 1000)
    }
  })

  restartAttempts = 0
}

export function stopPythonEngine(): void {
  restartAttempts = MAX_RESTART_ATTEMPTS
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
}

export function isEngineRunning(): boolean {
  return pythonProcess !== null && !pythonProcess.killed
}

export function sendToEngine(
  payload: Record<string, unknown>,
  options?: SendToEngineOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!pythonProcess?.stdin?.writable) {
      reject(new Error(
        'Engine is not running. This usually means Python is not installed or the engine failed to start. ' +
        'Check the terminal for errors.'
      ))
      return
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

    const timeoutId = setTimeout(() => {
      const idx = pendingQueue.findIndex((p) => p.timeoutId === timeoutId)
      if (idx >= 0) pendingQueue.splice(idx, 1)
      reject(new Error(
        `Engine request timed out after ${timeoutMs / 1000}s. ` +
        'The operation may be too heavy for your hardware, or the engine is stuck.'
      ))
    }, timeoutMs)

    pendingQueue.push({ resolve, reject, timeoutId })

    try {
      pythonProcess.stdin.write(JSON.stringify(payload) + '\n')
    } catch (err) {
      clearTimeout(timeoutId)
      const idx = pendingQueue.findIndex((p) => p.timeoutId === timeoutId)
      if (idx >= 0) pendingQueue.splice(idx, 1)
      reject(new Error(`Failed to send command to engine: ${err}`))
    }
  })
}
