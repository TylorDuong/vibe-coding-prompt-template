import { useState } from 'react'
import TimelineBar from './TimelineBar'

type TimelineSegment = {
  start: number
  end: number
  text: string
  words?: Array<{ word: string; start: number; end: number; probability: number }>
}

type TimelineMatch = {
  graphic: string
  tag: string
  matched_segment_start: number
  matched_segment_end: number
  matched_text: string
  similarity: number
}

type SilenceInterval = {
  start: number
  end: number
}

type TimelineEvent = {
  type: string
  start: number
  end?: number
  text?: string
  sfx?: string
  trigger?: string
  tag?: string
  filePath?: string
  similarity?: number
  animation?: string
}

type TimelineData = {
  video: { filename: string; size_bytes: number; extension: string; duration?: number } | null
  segments: TimelineSegment[]
  matches: TimelineMatch[]
  silences: SilenceInterval[]
  silenceThresholdMs: number
  events: TimelineEvent[]
  eventCounts?: Record<string, number>
}

type WordTrigger = { start: number; word: string }

type TimelinePreviewProps = {
  timeline: TimelineData
  selectedGraphicId: string | null
  wordTriggers: Record<string, WordTrigger>
  onWordAssign: (payload: { start: number; end: number; word: string }) => void
}

const EVENT_STYLES: Record<string, { bg: string; label: string; color: string }> = {
  caption: { bg: 'bg-blue-950/30', label: 'CAPTION', color: 'text-blue-400/70' },
  graphic: { bg: 'bg-emerald-950/30', label: 'GRAPHIC', color: 'text-emerald-400/70' },
  sfx: { bg: 'bg-amber-950/30', label: 'SFX', color: 'text-amber-400/70' },
  silence_cut: { bg: 'bg-red-950/30', label: 'CUT', color: 'text-red-400/70' },
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>
          &#9654;
        </span>
        {title} ({count})
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function isWordLinked(wStart: number, wText: string, triggers: Record<string, WordTrigger>): boolean {
  const t = wText.trim()
  return Object.values(triggers).some(
    (tr) => Math.abs(tr.start - wStart) < 0.03 && tr.word === t,
  )
}

export default function TimelinePreview({
  timeline,
  selectedGraphicId,
  wordTriggers,
  onWordAssign,
}: TimelinePreviewProps): React.JSX.Element {
  const silences = timeline.silences ?? []
  const events = timeline.events ?? []
  const counts = timeline.eventCounts ?? {}
  const totalSilence = silences.reduce((sum, s) => sum + (s.end - s.start), 0)
  const duration = timeline.video?.duration ?? 0

  return (
    <div className="m-4 space-y-4 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-sm font-medium text-zinc-300">Pipeline Result</h3>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        {duration > 0 && (
          <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-400">
            {duration.toFixed(1)}s
          </span>
        )}
        <span className="rounded bg-blue-900/40 px-2 py-1 text-blue-300">
          {counts.caption ?? timeline.segments.length} captions
        </span>
        <span className="rounded bg-red-900/40 px-2 py-1 text-red-300">
          {silences.length} silences ({totalSilence.toFixed(1)}s)
        </span>
        <span className="rounded bg-emerald-900/40 px-2 py-1 text-emerald-300">
          {counts.graphic ?? timeline.matches.length} graphics
        </span>
        <span className="rounded bg-amber-900/40 px-2 py-1 text-amber-300">
          {counts.sfx ?? 0} sfx
        </span>
      </div>

      {/* Visual timeline bar */}
      {duration > 0 && <TimelineBar events={events} duration={duration} />}

      {/* Collapsible event list */}
      {events.length > 0 && (
        <CollapsibleSection title="Timeline Events" count={events.length} defaultOpen>
          <ul className="space-y-1 max-h-60 overflow-auto">
            {events.map((evt, i) => {
              const style = EVENT_STYLES[evt.type] ?? {
                bg: 'bg-zinc-800/50',
                label: evt.type.toUpperCase(),
                color: 'text-zinc-400',
              }
              return (
                <li
                  key={i}
                  className={`flex items-baseline gap-2 rounded px-3 py-1.5 text-xs ${style.bg}`}
                >
                  <span className={`font-mono shrink-0 w-14 text-right ${style.color}`}>
                    {evt.start.toFixed(1)}s
                  </span>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${style.color} bg-black/20`}>
                    {style.label}
                  </span>
                  <span className="text-zinc-300 truncate">
                    {evt.type === 'caption' && evt.text}
                    {evt.type === 'graphic' &&
                      `${evt.tag || evt.filePath} (${evt.similarity != null && evt.similarity >= 0.99 ? 'manual' : `sim=${evt.similarity?.toFixed(2)}`})`}
                    {evt.type === 'sfx' && `${evt.sfx} [${evt.trigger}]`}
                    {evt.type === 'silence_cut' && evt.end != null && `${evt.start.toFixed(1)}s–${evt.end.toFixed(1)}s removed`}
                  </span>
                </li>
              )
            })}
          </ul>
        </CollapsibleSection>
      )}

      {/* Collapsible transcript — click words to place selected graphic */}
      {timeline.segments.length > 0 && (
        <CollapsibleSection title="Transcript" count={timeline.segments.length} defaultOpen>
          {!selectedGraphicId && (
            <p className="mb-2 text-[10px] text-amber-500/90">
              Select a graphic in the sidebar, then click a word here to set when it appears.
            </p>
          )}
          <ul className="space-y-2 max-h-64 overflow-auto">
            {timeline.segments.map((seg, i) => {
              const words = seg.words
              return (
                <li
                  key={i}
                  className="rounded bg-zinc-800/50 px-3 py-1.5 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-zinc-500">
                    {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s
                  </span>
                  {words && words.length > 0 ? (
                    <span className="text-zinc-300">
                      {words.map((w, wi) => {
                        const raw = w.word ?? ''
                        const display = raw.trim() || '·'
                        const isLinked = isWordLinked(w.start, raw, wordTriggers)
                        return (
                          <button
                            key={`${i}-${wi}-${w.start}`}
                            type="button"
                            disabled={!selectedGraphicId}
                            title={
                              selectedGraphicId
                                ? 'Place selected graphic at this word'
                                : 'Select a graphic in the sidebar first'
                            }
                            onClick={() =>
                              onWordAssign({
                                start: w.start,
                                end: w.end,
                                word: raw.trim() || display,
                              })
                            }
                            className={`
                              mx-0.5 inline rounded px-0.5 py-0.5 align-baseline
                              transition-colors
                              ${
                                selectedGraphicId
                                  ? 'cursor-pointer hover:bg-blue-600/40 hover:text-white'
                                  : 'cursor-default opacity-80'
                              }
                              ${isLinked ? 'bg-emerald-900/50 text-emerald-200' : ''}
                            `}
                          >
                            {display}
                          </button>
                        )
                      })}
                    </span>
                  ) : (
                    <span className="text-zinc-400">
                      {seg.text}
                      <span className="mt-1 block text-[10px] text-zinc-600">
                        No word-level timings in this segment; process again or use a clip with clearer speech.
                      </span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </CollapsibleSection>
      )}

      {/* Config */}
      <div className="flex gap-4 text-xs text-zinc-600 pt-2 border-t border-zinc-800">
        <span>Silence: {timeline.silenceThresholdMs}ms</span>
        <span>Attention: 3000ms</span>
      </div>
    </div>
  )
}

export type { TimelineData }
