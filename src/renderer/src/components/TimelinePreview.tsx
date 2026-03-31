import { useState, useRef, useEffect, type ReactNode, Fragment } from 'react'
import TimelineBar from './TimelineBar'
import PipelineVideoPreview from './PipelineVideoPreview'
import type { EncodedPreviewState } from '../hooks/useEncodedPreview'
import type { PipelineConfig, PipelinePreviewMeta } from '../hooks/useProcessPipeline'
import type { KeepSegment } from '../lib/timelineRemap'
import type { WordTrigger } from '../lib/graphicPlacements'
import {
  encodedFileDurationSec,
  outputTimeToEncodedFileSeconds,
  sourceTimeToOutput,
} from '../lib/timelineRemap'

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

type PendingWordClick = { start: number; end: number; word: string }

type TimelinePreviewProps = {
  timeline: TimelineData
  keepSegments: KeepSegment[]
  attentionLengthMs: number
  selectedGraphicId: string | null
  wordTriggers: Record<string, WordTrigger>
  pendingPlacementStart: PendingWordClick | null
  onWordAssign: (payload: { start: number; end: number; word: string }) => void
  pipelineConfig: PipelineConfig
  previewMeta?: PipelinePreviewMeta | null
  /** Source video for optional scrub preview (`local-file://`). */
  videoPath?: string
  /** Graphics panel (full width above transcript when embedded). */
  graphicsSidebar?: ReactNode
  /** Fires when the timeline bar docks to the viewport bottom (or false when undocked / unmounted). */
  onFloatingTimelineChange?: (docked: boolean) => void
  encodedPreviewPath?: string | null
  encodedPreviewState?: EncodedPreviewState
  encodedPreviewProgress?: number
  encodedPreviewError?: string | null
  encodedPreviewQueued?: boolean
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

const WORD_TIME_EPS = 0.03

function isWordHighlighted(
  wStart: number,
  wEnd: number,
  triggers: Record<string, WordTrigger>,
  selectedId: string | null,
  pending: PendingWordClick | null,
): boolean {
  for (const pl of Object.values(triggers)) {
    if (wStart >= pl.start - WORD_TIME_EPS && wEnd <= pl.end + WORD_TIME_EPS) {
      return true
    }
  }
  if (selectedId && pending) {
    if (
      Math.abs(wStart - pending.start) < WORD_TIME_EPS &&
      Math.abs(wEnd - pending.end) < WORD_TIME_EPS
    ) {
      return true
    }
  }
  return false
}

export default function TimelinePreview({
  timeline,
  keepSegments,
  attentionLengthMs,
  selectedGraphicId,
  wordTriggers,
  pendingPlacementStart,
  onWordAssign,
  pipelineConfig,
  previewMeta = null,
  videoPath,
  graphicsSidebar,
  onFloatingTimelineChange,
  encodedPreviewPath = null,
  encodedPreviewState = 'idle',
  encodedPreviewProgress = 0,
  encodedPreviewError = null,
  encodedPreviewQueued = false,
}: TimelinePreviewProps): React.JSX.Element {
  const silences = timeline.silences ?? []
  const events = timeline.events ?? []
  const counts = timeline.eventCounts ?? {}
  const totalSilence = silences.reduce((sum, s) => sum + (s.end - s.start), 0)
  const duration = timeline.video?.duration ?? 0
  const hasRemap = keepSegments.length > 0
  const [scrubTime, setScrubTime] = useState(0)
  const [timelineDocked, setTimelineDocked] = useState(false)
  /** Bumped when encoded preview `<video>` exposes real duration so seeks re-clamp to measured length. */
  const [encodedDurationRev, setEncodedDurationRev] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setScrubTime(0)
  }, [duration, videoPath])

  const encodedReady =
    encodedPreviewState === 'ready' &&
    typeof encodedPreviewPath === 'string' &&
    encodedPreviewPath.length > 0

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (!videoPath && !encodedReady) return
    if (!Number.isFinite(scrubTime) || scrubTime < 0) return

    let t: number
    if (encodedReady) {
      const tOut =
        keepSegments.length > 0 ? sourceTimeToOutput(scrubTime, keepSegments) : scrubTime
      const tFile = outputTimeToEncodedFileSeconds(tOut, pipelineConfig.videoSpeed)
      const cap = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
      const metaDur =
        previewMeta != null &&
        typeof previewMeta.outputDurationSec === 'number' &&
        previewMeta.outputDurationSec > 0
          ? previewMeta.outputDurationSec
          : 0
      const capMeta =
        metaDur > 0
          ? encodedFileDurationSec(metaDur, pipelineConfig.videoSpeed)
          : Number.POSITIVE_INFINITY
      /** Stay inside decodable range; real duration is often slightly below theory (esp. after setpts speed-up). */
      const endSlack = cap > 0 ? 0.06 : 1e-3
      t =
        cap > 0
          ? Math.min(Math.max(0, tFile), Math.max(0, cap - endSlack))
          : Math.min(Math.max(0, tFile), Math.max(0, capMeta - endSlack))
    } else {
      const cap = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration
      t = cap > 0 ? Math.min(scrubTime, cap) : scrubTime
    }
    if (Math.abs(v.currentTime - t) > 0.04) {
      v.currentTime = t
    }
  }, [
    scrubTime,
    videoPath,
    duration,
    encodedReady,
    keepSegments,
    encodedPreviewPath,
    pipelineConfig.videoSpeed,
    previewMeta,
    encodedDurationRev,
  ])

  useEffect(() => {
    onFloatingTimelineChange?.(timelineDocked)
  }, [timelineDocked, onFloatingTimelineChange])

  useEffect(() => {
    return () => {
      onFloatingTimelineChange?.(false)
    }
  }, [onFloatingTimelineChange])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    // Viewport root so docking works when the main app column scrolls, not only inner overflow.
    const io = new IntersectionObserver(
      ([e]) => {
        setTimelineDocked(!e.isIntersecting)
      },
      { threshold: 0, root: null, rootMargin: '0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [duration, videoPath])

  const barProps = {
    events,
    duration,
    scrubTime,
    onScrubTimeChange: setScrubTime,
    keepSegments,
    faceZoomWindows: previewMeta?.faceZoomWindows ?? [],
    faceZoomEnabled: pipelineConfig.faceZoomEnabled,
  }

  return (
    <Fragment>
    <div
      ref={scrollRef}
      className={`min-h-0 flex-1 space-y-4 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 ${timelineDocked ? 'pb-36' : ''}`}
    >
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
        {pipelineConfig.faceZoomEnabled &&
        previewMeta != null &&
        Array.isArray(previewMeta.faceZoomWindows) &&
        previewMeta.faceZoomWindows.length > 0 ? (
          <span className="rounded bg-violet-900/40 px-2 py-1 text-violet-300">
            {previewMeta.faceZoomWindows.length} zoom pulse
            {previewMeta.faceZoomWindows.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {/* Visual timeline bar + scrubber */}
      {duration > 0 && <TimelineBar {...barProps} />}

      {/* Dock timeline to bottom of viewport once this row scrolls out of view */}
      <div ref={sentinelRef} className="h-px w-full shrink-0 scroll-mt-0" aria-hidden />

      {videoPath && duration > 0 ? (
        <PipelineVideoPreview
          videoPath={videoPath}
          scrubTime={scrubTime}
          config={pipelineConfig}
          previewMeta={previewMeta}
          keepSegments={keepSegments}
          matches={timeline.matches}
          videoRef={videoRef}
          encodedPreviewPath={encodedPreviewPath}
          encodedPreviewState={encodedPreviewState}
          encodedPreviewProgress={encodedPreviewProgress}
          encodedPreviewError={encodedPreviewError}
          encodedPreviewQueued={encodedPreviewQueued}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (encodedReady) return
            if (Number.isFinite(v.duration) && scrubTime > v.duration) {
              setScrubTime(v.duration)
            }
          }}
          onEncodedDurationKnown={() => {
            setEncodedDurationRev((r) => r + 1)
          }}
        />
      ) : null}

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
              const outStart = hasRemap ? sourceTimeToOutput(evt.start, keepSegments) : null
              return (
                <li
                  key={i}
                  className={`flex items-baseline gap-2 rounded px-3 py-1.5 text-xs ${style.bg}`}
                >
                  <span
                    className={`font-mono shrink-0 text-right ${style.color} ${hasRemap ? 'min-w-[7.5rem]' : 'w-14'}`}
                  >
                    {evt.start.toFixed(1)}s src
                    {outStart != null && (
                      <span className="block text-[10px] text-zinc-500 font-normal">
                        {outStart.toFixed(1)}s out
                      </span>
                    )}
                  </span>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${style.color} bg-black/20`}>
                    {style.label}
                  </span>
                  <span className="text-zinc-300 truncate">
                    {evt.type === 'caption' && evt.text}
                    {evt.type === 'graphic' &&
                      `${evt.tag || evt.filePath} (${evt.similarity != null && evt.similarity >= 0.99 ? 'manual' : `sim=${evt.similarity?.toFixed(2)}`})`}
                    {evt.type === 'sfx' &&
                      (evt.sfx != null && String(evt.sfx).length > 0
                        ? `${evt.sfx} [${evt.trigger ?? ''}]`
                        : `[${evt.trigger ?? 'sfx'}]`)}
                    {evt.type === 'silence_cut' && evt.end != null && `${evt.start.toFixed(1)}s–${evt.end.toFixed(1)}s removed`}
                  </span>
                </li>
              )
            })}
          </ul>
        </CollapsibleSection>
      )}

      {/* Graphics (full width) then transcript */}
      {(timeline.segments.length > 0 || graphicsSidebar) && (
        <div className="space-y-4 border-t border-zinc-800 pt-4">
          {graphicsSidebar ? <div className="w-full min-w-0">{graphicsSidebar}</div> : null}
          <div className="min-h-0 min-w-0 w-full">
            {timeline.segments.length > 0 ? (
              <CollapsibleSection title="Transcript" count={timeline.segments.length} defaultOpen>
                {!selectedGraphicId && (
                  <p className="mb-2 text-[10px] text-amber-500/90">
                    Select a graphic or clip above, then click start and end words in the transcript.
                  </p>
                )}
                {selectedGraphicId && (
                  <p className="mb-2 text-[10px] text-zinc-500">
                    {pendingPlacementStart
                      ? 'Click the end word (or same word again for a minimal range).'
                      : 'Click the start word for placement.'}
                  </p>
                )}
                <ul className="space-y-2 max-h-[min(320px,40vh)] overflow-auto">
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
                              const isLinked = isWordHighlighted(
                                w.start,
                                w.end,
                                wordTriggers,
                                selectedGraphicId,
                                pendingPlacementStart,
                              )
                              return (
                                <button
                                  key={`${i}-${wi}-${w.start}`}
                                  type="button"
                                  disabled={!selectedGraphicId}
                                  title={
                                    selectedGraphicId
                                      ? pendingPlacementStart
                                        ? 'Set placement end at this word'
                                        : 'Set placement start at this word'
                                      : 'Select a graphic first'
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
                              No word-level timings in this segment; process again or use a clip with clearer
                              speech.
                            </span>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CollapsibleSection>
            ) : (
              graphicsSidebar && (
                <p className="text-xs text-zinc-500">No transcript segments for this file.</p>
              )
            )}
          </div>
        </div>
      )}

      {/* Config */}
      <div className="flex gap-4 text-xs text-zinc-600 pt-2 border-t border-zinc-800">
        <span>Silence: {timeline.silenceThresholdMs}ms</span>
        <span>Attention: {attentionLengthMs}ms</span>
      </div>
    </div>
    {timelineDocked && duration > 0 ? (
      <div className="fixed bottom-0 left-0 right-0 z-[500] border-t border-zinc-700 bg-zinc-950/98 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <div className="mx-auto max-w-4xl">
          <TimelineBar {...barProps} compact />
        </div>
      </div>
    ) : null}
    </Fragment>
  )
}

export type { TimelineData }
