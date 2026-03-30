import type { GraphicItem } from '../components/GraphicsSidebar'

export type WordTrigger = {
  start: number
  end: number
  word: string
}

export type TimelineEvent = {
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
  words?: unknown[]
}

export type TimelineDataLike = {
  video: { duration?: number } | null
  segments: unknown[]
  matches: Record<string, unknown>[]
  silences: unknown[]
  silenceThresholdMs: number
  events: TimelineEvent[]
  eventCounts?: Record<string, number>
}

function countEventTypes(events: TimelineEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of events) {
    const t = e.type ?? 'unknown'
    counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

/** Re-apply attention-gap SFX markers (mirrors engine/polish.py). */
export function injectAttentionSfx(
  events: TimelineEvent[],
  totalDuration: number,
  attentionLengthMs: number,
): TimelineEvent[] {
  if (totalDuration <= 0 || attentionLengthMs <= 0) return events

  const attentionSec = attentionLengthMs / 1000
  const visualTimes = events
    .filter((e) => e.type === 'graphic' || e.type === 'caption')
    .map((e) => e.start)
    .sort((a, b) => a - b)

  if (visualTimes.length === 0) return events

  const extra: TimelineEvent[] = []
  let prev = 0
  for (const t of visualTimes) {
    const gap = t - prev
    if (gap > attentionSec) {
      extra.push({
        type: 'sfx',
        start: prev + attentionSec,
        trigger: 'attention_fill',
      })
    }
    prev = t
  }

  if (extra.length === 0) return events
  return [...events, ...extra].sort((a, b) => a.start - b.start)
}

/**
 * Matches sent to export: manual word trigger wins; else engine match by graphic index/path.
 * `matched_segment_end` is start + display window so render + polish agree on on-screen length.
 */
export function buildExportMatches(
  graphics: GraphicItem[],
  pipelineMatches: Record<string, unknown>[],
  manual: Record<string, WordTrigger>,
  graphicDisplaySec: number,
): Record<string, unknown>[] {
  const displaySpan = Math.max(0.2, graphicDisplaySec)

  return graphics.map((g, i) => {
    const pl = manual[g.id]
    if (pl) {
      const t0 = pl.start
      return {
        graphic: g.filePath,
        tag: g.tag,
        matched_segment_start: t0,
        matched_segment_end: t0 + displaySpan,
        matched_text: pl.word,
        similarity: 1,
      }
    }

    const fromEngine = pipelineMatches[i] as { graphic?: string } | undefined
    if (fromEngine && typeof fromEngine.graphic === 'string' && fromEngine.graphic === g.filePath) {
      return pipelineMatches[i] as Record<string, unknown>
    }

    const found = pipelineMatches.find(
      (m) => typeof (m as { graphic?: string }).graphic === 'string' && (m as { graphic: string }).graphic === g.filePath,
    )
    if (found) return found as Record<string, unknown>

    return {
      graphic: g.filePath,
      tag: g.tag,
      matched_segment_start: 0,
      matched_segment_end: 0,
      matched_text: '',
      similarity: 0,
    }
  })
}

/**
 * Timeline for UI after manual graphic timing: drop old graphic / graphic SFX / attention_fill,
 * inject graphics from merged matches, re-run attention injection.
 */
export function mergeTimelineWithMatches(
  base: TimelineDataLike,
  mergedMatches: Record<string, unknown>[],
  attentionLengthMs: number,
): TimelineDataLike {
  const duration = base.video?.duration ?? 0
  const baseEvents = base.events ?? []

  const stripped = baseEvents.filter((ev) => {
    if (ev.type === 'graphic') return false
    if (ev.type === 'sfx' && ev.trigger === 'graphic_entry') return false
    if (ev.type === 'sfx' && ev.trigger === 'attention_fill') return false
    return true
  })

  const additions: TimelineEvent[] = []
  for (const m of mergedMatches) {
    const sim = typeof m.similarity === 'number' ? m.similarity : 0
    if (sim < 0.1) continue
    const fp = typeof m.graphic === 'string' ? m.graphic : ''
    if (!fp) continue
    const t = typeof m.matched_segment_start === 'number' ? m.matched_segment_start : 0
    const endRaw = m.matched_segment_end
    const end =
      typeof endRaw === 'number' && endRaw > t ? endRaw : t + 3
    additions.push({
      type: 'graphic',
      start: t,
      end,
      filePath: fp,
      tag: typeof m.tag === 'string' ? m.tag : '',
      similarity: sim,
      animation: 'slide_in',
    })
    additions.push({
      type: 'sfx',
      start: t,
      trigger: 'graphic_entry',
    })
  }

  const combined = [...stripped, ...additions].sort((a, b) => a.start - b.start)
  const withAttention = injectAttentionSfx(combined, duration, attentionLengthMs)

  return {
    ...base,
    matches: mergedMatches,
    events: withAttention,
    eventCounts: countEventTypes(withAttention),
  }
}
