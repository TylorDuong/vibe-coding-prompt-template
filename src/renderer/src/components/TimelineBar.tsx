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

  const captionEvents = events.filter((ev) => ev.type === 'caption' && ev.end != null)
  const silenceEvents = events.filter((ev) => ev.type === 'silence_cut' && ev.end != null)
  const graphicEvents = events.filter((ev) => ev.type === 'graphic')
  const sfxEvents = events.filter((ev) => ev.type === 'sfx')

  const barPercent = (start: number, end: number) => {
    const left = (start / duration) * 100
    const width = Math.max(0.35, ((end - start) / duration) * 100)
    return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }
  }

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
        className="relative w-full cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:rounded"
      >
        {/* Caption track (source timeline) */}
        <div className="relative mb-1 h-3 w-full overflow-hidden rounded bg-zinc-800/80">
          {captionEvents.map((ev, i) => {
            const end = ev.end ?? ev.start + 0.1
            const { left, width } = barPercent(ev.start, end)
            return (
              <div
                key={`cap-${i}`}
                className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-sm bg-blue-500/90"
                style={{ left, width }}
                title={`Caption ${ev.start.toFixed(1)}s–${end.toFixed(1)}s`}
              />
            )
          })}
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white/90 shadow-sm"
            style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
          />
        </div>

        {/* Main track: silence, graphics, sfx */}
        <div className="relative h-8 w-full overflow-hidden rounded bg-zinc-800">
          {silenceEvents.map((ev, i) => {
            const end = ev.end ?? ev.start
            const { left, width } = barPercent(ev.start, end)
            return (
              <div
                key={`sil-${i}`}
                className="pointer-events-none absolute top-0 h-full bg-red-900/30"
                style={{ left, width }}
                title={`Silence: ${ev.start.toFixed(1)}s–${end.toFixed(1)}s`}
              />
            )
          })}

          {graphicEvents.map((ev, i) => {
            const end =
              ev.end != null && ev.end > ev.start ? ev.end : ev.start + Math.max(0.2, duration * 0.02)
            const { left, width } = barPercent(ev.start, end)
            return (
              <div
                key={`gfx-${i}`}
                className="pointer-events-none absolute top-1 bottom-1 rounded-sm bg-emerald-500/85"
                style={{ left, width }}
                title={`Graphic ${ev.start.toFixed(1)}s–${end.toFixed(1)}s`}
              />
            )
          })}

          {sfxEvents.map((ev, i) => {
            const left = (ev.start / duration) * 100
            return (
              <div
                key={`sfx-${i}`}
                className="pointer-events-none absolute top-1 h-6 w-0.5 rounded-sm bg-amber-500"
                style={{ left: `${Math.min(left, 99.5)}%` }}
                title={`SFX @ ${ev.start.toFixed(1)}s`}
              />
            )
          })}

          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white/90 shadow-sm"
            style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
          />
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <div className="h-2 w-4 rounded-sm bg-blue-500/90" />
          <span className="text-[10px] text-zinc-500">captions (span)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-4 rounded-sm bg-emerald-500/85" />
          <span className="text-[10px] text-zinc-500">graphics (span)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-0.5 rounded-sm bg-amber-500" />
          <span className="text-[10px] text-zinc-500">sfx</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-4 rounded-sm bg-red-900/50" />
          <span className="text-[10px] text-zinc-500">silence cut</span>
        </div>
      </div>
    </div>
  )
}
