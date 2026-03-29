import type { FileMetadata } from './UploadZone'

type FileCardProps = {
  filePath: string
  meta: FileMetadata
  onClear: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FileCard({ filePath, meta, onClear }: FileCardProps): React.JSX.Element {
  return (
    <div className="m-4 flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-zinc-800 text-xs font-bold uppercase text-zinc-400">
        {meta.extension.replace('.', '')}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">{meta.filename}</p>
        <p className="text-xs text-zinc-500">{formatBytes(meta.size_bytes)}</p>
        <p className="truncate text-xs text-zinc-700">{filePath}</p>
      </div>
      <button
        onClick={onClear}
        className="rounded-md px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        Clear
      </button>
    </div>
  )
}
