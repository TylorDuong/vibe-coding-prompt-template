import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { KeepSegment } from '../lib/timelineRemap'
import { outputWindowToSourceSpans, sourceTimeToOutput } from '../lib/timelineRemap'

type TimelineEvent = {
  type: string
  start: number
  end?: number
  text?: string
  trigger?: string
  tag?: string
  filePath?: string
}

type ZoomWin = { start: number; end: number }

type TooltipLine = { text: string; className: string }

type TimelineBarProps = {
  events: TimelineEvent[]
  duration: number
  scrubTime: number
  onScrubTimeChange: (t: number) => void
  keepSegments?: KeepSegment[]
  faceZoomWindows?: ZoomWin[]
  faceZoomEnabled?: boolean
  /** Hide bottom legend (e.g. docked bar). */
  compact?: boolean
}

function buildHoverLines(
  t: number,
  events: TimelineEvent[],
  duration: number,
  keepSegments: KeepSegment[],
  faceZoomWindows: ZoomWin[],
  faceZoomEnabled: boolean,
): TooltipLine[] {
  const lines: TooltipLine[] = []
  const eps = 0.02

  for (const ev of events) {
    if (ev.type === 'caption' && ev.end != null && t >= ev.start - eps && t < ev.end + eps) {
      const snippet = (ev.text ?? '').slice(0, 80)
      lines.push({
        text: `Caption: ${snippet}${(ev.text?.length ?? 0) > 80 ? '…' : ''}`,
        className: 'text-blue-300',
      })
      break
    }
  }

  for (const ev of events) {
    if (ev.type === 'graphic') {
      const end =
        ev.end != null && ev.end > ev.start ? ev.end : ev.start + Math.max(0.2, duration * 0.02)
      if (t >= ev.start - eps && t < end + eps) {
        const label = ev.tag || ev.filePath || 'graphic'
        lines.push({ text: `Graphic: ${label}`, className: 'text-emerald-300' })
        break
      }
    }
  }

  for (const ev of events) {
    if (ev.type === 'silence_cut' && ev.end != null && t >= ev.start && t <= ev.end) {
      lines.push({
        text: `Silence cut: ${ev.start.toFixed(2)}s–${ev.end.toFixed(2)}s`,
        className: 'text-red-300',
      })
      break
    }
  }

  for (const ev of events) {
    if (ev.type === 'sfx' && Math.abs(ev.start - t) < Math.max(0.04, duration * 0.003)) {
      lines.push({
        text: `SFX: [${ev.trigger ?? 'cue'}]`,
        className: 'text-amber-300',
      })
      break
    }
  }

  if (faceZoomEnabled && keepSegments.length > 0 && faceZoomWindows.length > 0) {
    const tOut = sourceTimeToOutput(t, keepSegments)
    for (const w of faceZoomWindows) {
      if (tOut >= w.start && tOut < w.end) {
        lines.push({
          text: `Face zoom (export timeline ${tOut.toFixed(2)}s)`,
          className: 'text-violet-300',
        })
        break
      }
    }
  }

  if (lines.length === 0) {
    lines.push({ text: `${t.toFixed(2)}s — no markers`, className: 'text-zinc-400' })
  }
  return lines
}

export default function TimelineBar({
  events,
  duration,
  scrubTime,
  onScrubTimeChange,
  keepSegments = [],
  faceZoomWindows = [],
  faceZoomEnabled = false,
  compact = false,
}: TimelineBarProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    lines: TooltipLine[]
  } | null>(null)

  const faceZoomSourceSpans = useMemo(() => {
    if (!faceZoomEnabled || keepSegments.length === 0 || faceZoomWindows.length === 0) {
      return []
    }
    const spans: Array<{ start: number; end: number }> = []
    for (const w of faceZoomWindows) {
      spans.push(...outputWindowToSourceSpans(w.start, w.end, keepSegments))
    }
    return spans
  }, [faceZoomEnabled, faceZoomWindows, keepSegments])

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

  const updateHover = useCallback(
    (clientX: number, clientY: number) => {
      if (duration <= 0) return
      const t = timeFromClientX(clientX)
      const lines = buildHoverLines(
        t,
        events,
        duration,
        keepSegments,
        faceZoomWindows,
        faceZoomEnabled,
      )
      setTooltip({ x: clientX, y: clientY, lines })
    },
    [duration, events, keepSegments, faceZoomWindows, faceZoomEnabled, timeFromClientX],
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
      if (duration <= 0) return
      if (draggingRef.current) {
        onScrubTimeChange(timeFromClientX(e.clientX))
        return
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        updateHover(e.clientX, e.clientY)
      })
    },
    [duration, onScrubTimeChange, timeFromClientX, updateHover],
  )

  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const onPointerLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
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

  const tooltipNode =
    tooltip != null ? (
      <div
        className="pointer-events-none fixed z-[6000] max-w-xs rounded-md border border-zinc-700 bg-zinc-950/95 px-2 py-1.5 text-[10px] shadow-lg"
        style={{
          left: Math.min(tooltip.x + 12, typeof window !== 'undefined' ? window.innerWidth - 200 : 0),
          top: Math.max(8, tooltip.y - 8 - tooltip.lines.length * 16),
        }}
      >
        {tooltip.lines.map((line, i) => (
          <div key={i} className={line.className}>
            {line.text}
          </div>
        ))}
      </div>
    ) : null

  return (
    <div className="relative mt-3 w-full">
      {tooltipNode != null ? createPortal(tooltipNode, document.body) : null}

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
        onPointerLeave={onPointerLeave}
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
        <div className="relative mb-1 h-3 w-full overflow-hidden rounded bg-zinc-800/80">
          {captionEvents.map((ev, i) => {
            const end = ev.end ?? ev.start + 0.1
            const { left, width } = barPercent(ev.start, end)
            return (
              <div
                key={`cap-${i}`}
                className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-sm bg-blue-500/90"
                style={{ left, width }}
              />
            )
          })}
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white/90 shadow-sm"
            style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
          />
        </div>

        <div className="relative h-8 w-full overflow-hidden rounded bg-zinc-800">
          {silenceEvents.map((ev, i) => {
            const end = ev.end ?? ev.start
            const { left, width } = barPercent(ev.start, end)
            return (
              <div
                key={`sil-${i}`}
                className="pointer-events-none absolute top-0 h-full bg-red-900/30"
                style={{ left, width }}
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
              />
            )
          })}

          {faceZoomSourceSpans.map((span, i) => {
            const { left, width } = barPercent(span.start, span.end)
            return (
              <div
                key={`fz-${i}`}
                className="pointer-events-none absolute bottom-0 h-1.5 rounded-sm bg-violet-500/90"
                style={{ left, width }}
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
              />
            )
          })}

          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white/90 shadow-sm"
            style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
          />
        </div>
      </div>

      {!compact ? (
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
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-4 rounded-sm bg-violet-500/90" />
            <span className="text-[10px] text-zinc-500">face zoom (export timeline)</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
