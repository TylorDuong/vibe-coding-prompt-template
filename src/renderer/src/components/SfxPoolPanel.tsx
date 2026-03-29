import { useCallback } from 'react'

export type SfxTrigger =
  | 'graphic_entry'
  | 'caption_entry'
  | 'silence_cut'
  | 'attention_fill'
  | 'none'

export type SfxSlot = {
  id: string
  label: string
  description: string
  trigger: SfxTrigger
  filePath: string | null
  fileName: string | null
}

export type SfxPool = Record<string, string>

type DialogResult = {
  canceled: boolean
  filePath?: string
}

type SfxPoolPanelProps = {
  slots: SfxSlot[]
  onUpdate: (id: string, updates: Partial<SfxSlot>) => void
}

const TRIGGER_OPTIONS: { value: SfxTrigger; label: string }[] = [
  { value: 'graphic_entry', label: 'When graphic shows' },
  { value: 'caption_entry', label: 'When caption shows' },
  { value: 'silence_cut', label: 'When cut happens' },
  { value: 'attention_fill', label: 'Attention fill (long gap)' },
  { value: 'none', label: 'Disabled' },
]

function fileNameFromPath(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export default function SfxPoolPanel({ slots, onUpdate }: SfxPoolPanelProps): React.JSX.Element {
  const handleImport = useCallback(
    async (slotId: string) => {
      try {
        const result = (await window.electron.invoke('dialog:openSfx')) as DialogResult
        if (result.canceled || !result.filePath) return
        onUpdate(slotId, {
          filePath: result.filePath,
          fileName: fileNameFromPath(result.filePath),
        })
      } catch {
        // dialog cancelled
      }
    },
    [onUpdate]
  )

  const handleClear = useCallback(
    (slotId: string) => {
      onUpdate(slotId, { filePath: null, fileName: null })
    },
    [onUpdate]
  )

  const handleTriggerChange = useCallback(
    (slotId: string, trigger: SfxTrigger) => {
      onUpdate(slotId, { trigger })
    },
    [onUpdate]
  )

  return (
    <div className="mx-4 mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
        Sound Effects Pool
      </h3>
      <p className="text-[10px] text-zinc-600 mb-2 leading-relaxed">
        Each slot maps to how the engine uses SFX: graphic match (whoosh), new caption line (pop),
        end of a silence cut (cut), and pacing fills in long gaps (chime).
      </p>
      <div className="space-y-2.5">
        {slots.map((slot) => (
          <div key={slot.id} className="flex items-center gap-2">
            <div className="w-28 shrink-0">
              <span className="text-xs text-zinc-400">{slot.label}</span>
              <p className="text-[10px] text-zinc-600 leading-tight">{slot.description}</p>
            </div>

            {slot.filePath ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="truncate text-xs text-zinc-300 bg-zinc-800 rounded px-2 py-1 flex-1">
                  {slot.fileName}
                </span>
                <button
                  onClick={() => handleClear(slot.id)}
                  className="text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                >
                  x
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleImport(slot.id)}
                className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-400
                           hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              >
                Import...
              </button>
            )}

            <select
              value={slot.trigger}
              onChange={(e) => handleTriggerChange(slot.id, e.target.value as SfxTrigger)}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none
                         focus:ring-1 focus:ring-blue-500/50 shrink-0 max-w-[11rem]"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

export function buildSfxPool(slots: SfxSlot[]): SfxPool {
  const pool: SfxPool = {}
  for (const slot of slots) {
    if (slot.filePath && slot.trigger !== 'none') {
      pool[slot.trigger] = slot.filePath
    }
  }
  return pool
}

export const DEFAULT_SFX_SLOTS: SfxSlot[] = [
  {
    id: 'whoosh',
    label: 'Whoosh SFX',
    description: 'Graphic appears (engine default: whoosh)',
    trigger: 'graphic_entry',
    filePath: null,
    fileName: null,
  },
  {
    id: 'pop',
    label: 'Pop SFX',
    description: 'Caption line starts (engine default: pop)',
    trigger: 'caption_entry',
    filePath: null,
    fileName: null,
  },
  {
    id: 'cut',
    label: 'Cut SFX',
    description: 'Speech resumes after silence cut',
    trigger: 'silence_cut',
    filePath: null,
    fileName: null,
  },
  {
    id: 'chime',
    label: 'Chime SFX',
    description: 'Attention fill in long gaps (engine default: pop/chime)',
    trigger: 'attention_fill',
    filePath: null,
    fileName: null,
  },
]
