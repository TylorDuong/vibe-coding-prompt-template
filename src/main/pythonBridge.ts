import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

let pythonProcess: ChildProcessWithoutNullStreams | null = null
let buffer = ''
const pendingQueue: PendingRequest[] = []

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
  pythonProcess = spawn(getPythonPath(), ['-m', 'engine.main'], {
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
        if (pending) pending.resolve(parsed)
      } catch {
        console.error('[pythonBridge] Bad JSON from engine:', trimmed)
      }
    }
  })

  pythonProcess.stderr.on('data', (chunk: Buffer) => {
    console.error('[pythonBridge] stderr:', chunk.toString())
  })

  pythonProcess.on('exit', (code) => {
    console.log(`[pythonBridge] Python process exited with code ${code}`)
    pythonProcess = null
    while (pendingQueue.length) {
      const p = pendingQueue.shift()
      if (p) p.reject(new Error(`Python engine exited with code ${code}`))
    }
  })
}

export function stopPythonEngine(): void {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
}

export function sendToEngine(payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!pythonProcess?.stdin?.writable) {
      reject(new Error('Python engine is not running'))
      return
    }
    pendingQueue.push({ resolve, reject })
    pythonProcess.stdin.write(JSON.stringify(payload) + '\n')
  })
}
