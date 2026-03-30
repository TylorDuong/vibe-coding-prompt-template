import { useEffect, useState } from 'react'
import type { FileMetadata } from './UploadZone'

type FileCardProps = {
  filePath: string
  meta: FileMetadata
  onClear: () => void
}

type ThumbnailResult = {
  ok: boolean
  data?: { thumbnail: string }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FileCard({ filePath, meta, onClear }: FileCardProps): React.JSX.Element {
  const [thumbnail, setThumbnail] = useState<string | null>(null)

  useEffect(() => {
    window.electron
      .invoke('engine:thumbnail', { videoPath: filePath })
      .then((result) => {
        const r = result as ThumbnailResult
        if (r.ok && r.data?.thumbnail) {
          setThumbnail(r.data.thumbnail)
        }
      })
      .catch(() => {})
  }, [filePath])

  return (
    <div className="m-4 flex items-start gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      {/* Thumbnail */}
      <div className="shrink-0 h-20 w-32 rounded-md overflow-hidden bg-zinc-800 flex items-center justify-center">
        {thumbnail ? (
          <img src={thumbnail} alt="Video thumbnail" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-bold uppercase text-zinc-600">
            {meta.extension.replace('.', '')}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">{meta.filename}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{formatBytes(meta.size_bytes)}</p>
        {meta.duration != null && (
          <p className="text-xs text-zinc-500">{meta.duration.toFixed(1)}s duration</p>
        )}
        <p className="truncate text-xs text-zinc-700 mt-1">{filePath}</p>
      </div>

      <button
        onClick={onClear}
        className="shrink-0 rounded-md px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        Clear
      </button>
    </div>
  )
}
