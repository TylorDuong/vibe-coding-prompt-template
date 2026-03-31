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
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Set when user linked a transcript word to this graphic */
  wordTriggers: Record<string, { start: number; word: string }>
  onClearPlacement: (id: string) => void
  /** Next to transcript column (rounded card) vs full-height page rail */
  embedded?: boolean
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
  selectedId,
  onSelect,
  wordTriggers,
  onClearPlacement,
  embedded = false,
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
    <aside
      className={
        embedded
          ? 'flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 min-h-0 max-h-[min(78vh,880px)]'
          : 'flex w-72 flex-col border-l border-zinc-800 bg-zinc-950'
      }
    >
      <div
        className={`space-y-1 border-b border-zinc-800 ${embedded ? 'px-3 py-2' : 'px-4 py-3'}`}
      >
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Graphics ({graphics.length})
        </h2>
        <p className="text-[10px] leading-snug text-zinc-600">
          Select a graphic, then click a word in the transcript to set when it appears. Tags are optional
          (auto-match still runs as a fallback).
        </p>
      </div>

      {/* Drop zone + browse button */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          ${embedded ? 'mx-2' : 'mx-3'} mt-3 flex flex-col items-center gap-2 rounded border border-dashed p-2.5
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
      <div className={`flex-1 space-y-2 overflow-auto ${embedded ? 'p-2' : 'p-3'}`}>
        {graphics.map((g) => (
          <div
            key={g.id}
            className={`rounded-lg border border-zinc-800 bg-zinc-900 ${embedded ? 'p-2' : 'p-2.5'}`}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(selectedId === g.id ? null : g.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(selectedId === g.id ? null : g.id)
                }
              }}
              className={`w-full cursor-pointer rounded-md text-left outline-none transition-colors ${
                selectedId === g.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-900' : ''
              }`}
            >
              <div className="flex gap-2">
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
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(g.id)
                      }}
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
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Describe this graphic (optional)..."
                    className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200
                               placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                  {wordTriggers[g.id] && (
                    <p className="mt-1 text-[10px] text-emerald-500/90 truncate" title={wordTriggers[g.id].word}>
                      @ {wordTriggers[g.id].start.toFixed(2)}s — “{wordTriggers[g.id].word}”
                    </p>
                  )}
                </div>
              </div>
            </div>
            {wordTriggers[g.id] && (
              <button
                type="button"
                onClick={() => onClearPlacement(g.id)}
                className="mt-1.5 w-full rounded bg-zinc-800 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700"
              >
                Clear word placement
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
