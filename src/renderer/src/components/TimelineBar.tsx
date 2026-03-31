import { useCallback, useRef, type PointerEvent } from 'react'

type TimelineEvent = {
  type: string
  start: number
  end?: number
}

type TimelineBarProps = {
  events: TimelineEvent[]
  duration: number
  scrubTime: number
  onScrubTimeChange: (t: number) => void
}

const COLOR_MAP: Record<string, string> = {
  caption: 'bg-blue-500',
  graphic: 'bg-emerald-500',
  sfx: 'bg-amber-500',
  silence_cut: 'bg-red-500/60',
}

export default function TimelineBar({
  events,
  duration,
  scrubTime,
  onScrubTimeChange,
}: TimelineBarProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || duration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const x = Math.min(Math.max(0, clientX - rect.left), rect.width)
      return (x / rect.width) * duration
    },
    [duration],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (duration <= 0) return
      e.preventDefault()
      draggingRef.current = true
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      onScrubTimeChange(timeFromClientX(e.clientX))
    },
    [duration, onScrubTimeChange, timeFromClientX],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || duration <= 0) return
      onScrubTimeChange(timeFromClientX(e.clientX))
    },
    [duration, onScrubTimeChange, timeFromClientX],
  )

  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  if (duration <= 0) return <></>

  const playheadPct = Math.min(100, Math.max(0, (scrubTime / duration) * 100))

  return (
    <div className="mt-3 w-full">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] text-zinc-600">0s</span>
        <span className="text-[10px] font-mono text-zinc-500">
          {scrubTime.toFixed(2)}s / {duration.toFixed(1)}s
        </span>
        <span className="text-[10px] text-zinc-600">{duration.toFixed(1)}s</span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={scrubTime}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          const step = duration / 200
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            onScrubTimeChange(Math.max(0, scrubTime - step))
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            onScrubTimeChange(Math.min(duration, scrubTime + step))
          }
        }}
        className="relative h-8 w-full cursor-pointer touch-none overflow-hidden rounded bg-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        {events
          .filter((ev) => ev.type === 'silence_cut' && ev.end != null)
          .map((ev, i) => {
            const left = (ev.start / duration) * 100
            const width = (((ev.end ?? ev.start) - ev.start) / duration) * 100
            return (
              <div
                key={`sil-${i}`}
                className="pointer-events-none absolute top-0 h-full bg-red-900/30"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`Silence: ${ev.start.toFixed(1)}s–${(ev.end ?? ev.start).toFixed(1)}s`}
              />
            )
          })}

        {events
          .filter((ev) => ev.type !== 'silence_cut')
          .map((ev, i) => {
            const left = (ev.start / duration) * 100
            const color = COLOR_MAP[ev.type] ?? 'bg-zinc-500'
            return (
              <div
                key={`evt-${i}`}
                className={`pointer-events-none absolute top-1 h-6 w-1 rounded-sm ${color}`}
                style={{ left: `${Math.min(left, 99)}%` }}
                title={`${ev.type} @ ${ev.start.toFixed(1)}s`}
              />
            )
          })}

        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-white/90 shadow-sm"
          style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-3">
        {Object.entries(COLOR_MAP).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-sm ${color}`} />
            <span className="text-[10px] text-zinc-500">{type.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
