import { useState, useCallback, type DragEvent } from 'react'

export type GraphicItem = {
  id: string
  filePath: string
  fileName: string
  tag: string
}

type GraphicsSidebarProps = {
  graphics: GraphicItem[]
  onAdd: (graphic: GraphicItem) => void
  onRemove: (id: string) => void
  onTagChange: (id: string, tag: string) => void
}

type DialogImagesResult = {
  canceled: boolean
  filePaths: string[]
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

let nextId = 0

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export default function GraphicsSidebar({
  graphics,
  onAdd,
  onRemove,
  onTagChange,
}: GraphicsSidebarProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)

  const addFromPath = useCallback(
    (filePath: string) => {
      onAdd({
        id: `graphic-${++nextId}`,
        filePath,
        fileName: fileNameFromPath(filePath),
        tag: '',
      })
    },
    [onAdd]
  )

  const handleBrowse = useCallback(async () => {
    try {
      const result = (await window.electron.invoke('dialog:openImages')) as DialogImagesResult
      if (result.canceled || !result.filePaths.length) return
      for (const fp of result.filePaths) {
        addFromPath(fp)
      }
    } catch {
      // dialog failed silently
    }
  }, [addFromPath])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        const filePath = (file as File & { path?: string }).path
        if (!filePath) continue

        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
        if (!IMAGE_EXTENSIONS.has(ext)) continue

        addFromPath(filePath)
      }
    },
    [addFromPath]
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  return (
    <aside className="flex w-72 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Graphics ({graphics.length})
        </h2>
      </div>

      {/* Drop zone + browse button */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          mx-3 mt-3 flex flex-col items-center gap-2 rounded border border-dashed p-3
          transition-colors text-xs
          ${isDragging ? 'border-blue-500 bg-blue-500/5 text-blue-400' : 'border-zinc-800 text-zinc-600'}
        `}
      >
        <span>{isDragging ? 'Release to add' : 'Drop images here'}</span>
        <button
          onClick={handleBrowse}
          className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-400
                     hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        >
          Browse...
        </button>
      </div>

      {/* Graphics list */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {graphics.map((g) => (
          <div key={g.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
            <div className="flex gap-2">
              {/* Image preview */}
              <div className="shrink-0 h-12 w-12 rounded overflow-hidden bg-zinc-800">
                <img
                  src={`local-file://${encodeURIComponent(g.filePath)}`}
                  alt={g.fileName}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs text-zinc-300 max-w-[140px]">
                    {g.fileName}
                  </span>
                  <button
                    onClick={() => onRemove(g.id)}
                    className="ml-1 text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                    title="Remove"
                  >
                    x
                  </button>
                </div>
                <input
                  type="text"
                  value={g.tag}
                  onChange={(e) => onTagChange(g.id, e.target.value)}
                  placeholder="Describe this graphic..."
                  className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200
                             placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-blue-500/50"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
