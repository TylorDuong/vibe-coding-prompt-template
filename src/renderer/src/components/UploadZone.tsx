import { useState, useCallback, type DragEvent } from 'react'

type FileMetadata = {
  filename: string
  size_bytes: number
  extension: string
  duration?: number
}

type IngestResult = {
  ok: boolean
  data?: FileMetadata
  error?: string
}

type DialogResult = {
  canceled: boolean
  filePath?: string
}

type UploadZoneProps = {
  onFileAccepted: (filePath: string, meta: FileMetadata) => void
}

const ACCEPTED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi'])

export default function UploadZone({ onFileAccepted }: UploadZoneProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const ingestFile = useCallback(
    async (filePath: string) => {
      const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        setError(`Unsupported format "${ext}". Use MP4, MOV, WebM, MKV, or AVI.`)
        return
      }

      setIsProcessing(true)
      setError(null)
      try {
        const result = (await window.electron.invoke('engine:ingest', {
          videoPath: filePath,
        })) as IngestResult

        if (result.ok && result.data) {
          onFileAccepted(filePath, result.data)
        } else {
          setError(result.error ?? 'Failed to ingest file')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'IPC call failed')
      } finally {
        setIsProcessing(false)
      }
    },
    [onFileAccepted]
  )

  const handleChooseFile = useCallback(async () => {
    setError(null)
    try {
      const result = (await window.electron.invoke('dialog:openVideo')) as DialogResult
      if (result.canceled || !result.filePath) return
      await ingestFile(result.filePath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file dialog')
    }
  }, [ingestFile])

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setError(null)

      const file = e.dataTransfer.files[0]
      if (!file) return

      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        await ingestFile(filePath)
        return
      }

      setError(
        'Could not read the file path from drag-and-drop. ' +
        'Please use the "Choose File" button instead.'
      )
    },
    [ingestFile]
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`
        flex flex-1 items-center justify-center rounded-lg border-2 border-dashed
        transition-colors duration-150 m-4
        ${isDragging ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-800 bg-zinc-950'}
        ${isProcessing ? 'pointer-events-none opacity-60' : ''}
      `}
    >
      <div className="flex flex-col items-center gap-3 text-zinc-500">
        {isProcessing ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
            <p className="text-sm">Validating file...</p>
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isDragging ? 'text-blue-400' : 'text-zinc-700'}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-sm">
              {isDragging ? 'Release to upload' : 'Drop a video file here'}
            </p>
            <p className="text-xs text-zinc-600">or</p>
            <button
              onClick={handleChooseFile}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white
                         transition-colors hover:bg-blue-500 active:bg-blue-700"
            >
              Choose File
            </button>
            <p className="text-xs text-zinc-700">MP4, MOV, WebM, MKV, AVI</p>
          </>
        )}
        {error && (
          <p className="mt-2 max-w-xs text-center text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}

export { type FileMetadata }
