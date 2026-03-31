import { useState, useCallback, type DragEvent } from 'react'
import type { PipelineConfig } from '../hooks/useProcessPipeline'
import type { PlacementEndMode, WordTrigger } from '../lib/graphicPlacements'
import type { GraphicItem, GraphicKind } from '../lib/graphicsTypes'
import { absPathToLocalFileUrl } from '../lib/localFileUrl'

export type { GraphicItem } from '../lib/graphicsTypes'

type GraphicsSidebarProps = {
  graphics: GraphicItem[]
  onAdd: (graphic: GraphicItem) => void
  onRemove: (id: string) => void
  onTagChange: (id: string, tag: string) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  wordTriggers: Record<string, WordTrigger>
  onClearPlacement: (id: string) => void
  placementEndMode: PlacementEndMode
  onPlacementEndModeChange: (mode: PlacementEndMode) => void
  embedded?: boolean
  pipelineConfig: PipelineConfig
  onPipelineConfigChange: (config: PipelineConfig) => void
  configDisabled?: boolean
}

type DialogMediaResult = {
  canceled: boolean
  filePaths: string[]
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi'])

let nextId = 0

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function kindForPath(filePath: string): GraphicKind {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image'
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
  placementEndMode,
  onPlacementEndModeChange,
  embedded = false,
  pipelineConfig,
  onPipelineConfigChange,
  configDisabled = false,
}: GraphicsSidebarProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)
  const disabled = configDisabled

  const patchConfig = useCallback(
    (partial: Partial<PipelineConfig>) => {
      onPipelineConfigChange({ ...pipelineConfig, ...partial })
    },
    [onPipelineConfigChange, pipelineConfig],
  )

  const addFromPath = useCallback(
    (filePath: string) => {
      onAdd({
        id: `graphic-${++nextId}`,
        filePath,
        fileName: fileNameFromPath(filePath),
        tag: '',
        kind: kindForPath(filePath),
      })
    },
    [onAdd],
  )

  const handleBrowseImages = useCallback(async () => {
    try {
      const result = (await window.electron.invoke('dialog:openImages')) as DialogMediaResult
      if (result.canceled || !result.filePaths.length) return
      for (const fp of result.filePaths) {
        addFromPath(fp)
      }
    } catch {
      /* dialog failed */
    }
  }, [addFromPath])

  const handleBrowseMedia = useCallback(async () => {
    try {
      const result = (await window.electron.invoke('dialog:openGraphicMedia')) as DialogMediaResult
      if (result.canceled || !result.filePaths.length) return
      for (const fp of result.filePaths) {
        addFromPath(fp)
      }
    } catch {
      /* dialog failed */
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
        if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) continue

        addFromPath(filePath)
      }
    },
    [addFromPath],
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
          ? 'flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 min-h-0'
          : 'flex w-72 flex-col border-l border-zinc-800 bg-zinc-950'
      }
    >
      <div
        className={`space-y-1 border-b border-zinc-800 ${embedded ? 'px-3 py-2' : 'px-4 py-3'}`}
      >
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Graphics & clips ({graphics.length})
        </h2>
        <p className="text-[10px] leading-snug text-zinc-600">
          Select an item, click a start word in the transcript, then an end word. Range highlights show
          on-screen timing. Tags are optional (auto-match still runs as a fallback).
        </p>
      </div>

      <div
        className={`space-y-2 border-b border-zinc-800 ${embedded ? 'px-3 py-2' : 'px-4 py-2'}`}
      >
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Placement end
        </h3>
        <div className="flex flex-wrap gap-2 text-[10px] text-zinc-500">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="placement-end"
              checked={placementEndMode === 'word'}
              onChange={() => onPlacementEndModeChange('word')}
              disabled={disabled}
              className="accent-blue-500"
            />
            End of end word
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="placement-end"
              checked={placementEndMode === 'sentence'}
              onChange={() => onPlacementEndModeChange('sentence')}
              disabled={disabled}
              className="accent-blue-500"
            />
            End of sentence (segment)
          </label>
        </div>
      </div>

      <div
        className={`space-y-2 border-b border-zinc-800 ${embedded ? 'px-3 py-2' : 'px-4 py-2'}`}
      >
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Graphic settings (export)
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
            Position
            <select
              value={pipelineConfig.graphicPosition}
              onChange={(e) =>
                patchConfig({
                  graphicPosition: e.target.value as PipelineConfig['graphicPosition'],
                })
              }
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            >
              <option value="center">Center</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="top_right">Top right</option>
              <option value="top_left">Top left</option>
              <option value="bottom_right">Bottom right</option>
              <option value="bottom_left">Bottom left</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
            Motion
            <select
              value={pipelineConfig.graphicMotion}
              onChange={(e) =>
                patchConfig({
                  graphicMotion: e.target.value as PipelineConfig['graphicMotion'],
                })
              }
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            >
              <option value="none">None</option>
              <option value="slide_in">Slide in (right)</option>
              <option value="slide_left">Slide from left</option>
              <option value="slide_up">Slide up</option>
              <option value="slide_down">Slide down</option>
              <option value="scale_in">Scale in</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
            Width (%)
            <input
              type="number"
              min={10}
              max={100}
              step={5}
              value={pipelineConfig.graphicWidthPercent}
              onChange={(e) => patchConfig({ graphicWidthPercent: Number(e.target.value) })}
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
            Move duration (s)
            <input
              type="number"
              min={0}
              max={3}
              step={0.05}
              value={pipelineConfig.graphicAnimInSec}
              onChange={(e) => patchConfig({ graphicAnimInSec: Number(e.target.value) })}
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
            Fade in (s)
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={pipelineConfig.graphicFadeInSec}
              onChange={(e) => patchConfig({ graphicFadeInSec: Number(e.target.value) })}
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
            Fade out (s)
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={pipelineConfig.graphicFadeOutSec}
              onChange={(e) => patchConfig({ graphicFadeOutSec: Number(e.target.value) })}
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            />
          </label>
        </div>
      </div>

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
        <span>{isDragging ? 'Release to add' : 'Drop images or video clips here'}</span>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={handleBrowseImages}
            className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-400
                       hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            Images…
          </button>
          <button
            type="button"
            onClick={handleBrowseMedia}
            className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-400
                       hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            Images + clips…
          </button>
        </div>
      </div>

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
                <div className="relative shrink-0 h-12 w-12 rounded overflow-hidden bg-zinc-800">
                  {g.kind === 'video' ? (
                    <video
                      src={absPathToLocalFileUrl(g.filePath)}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={absPathToLocalFileUrl(g.filePath)}
                      alt={g.fileName}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  )}
                  {g.kind === 'video' ? (
                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-0.5 text-[8px] text-zinc-300">
                      VID
                    </span>
                  ) : null}
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
                    <p
                      className="mt-1 text-[10px] text-emerald-500/90 truncate"
                      title={`${wordTriggers[g.id].startWord} → ${wordTriggers[g.id].endWord}`}
                    >
                      @ {wordTriggers[g.id].start.toFixed(2)}s–{wordTriggers[g.id].end.toFixed(2)}s — “
                      {wordTriggers[g.id].startWord}” → “{wordTriggers[g.id].endWord}” (
                      {wordTriggers[g.id].endMode})
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
                Clear placement
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
