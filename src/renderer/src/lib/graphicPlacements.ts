import type { GraphicItem } from './graphicsTypes'

const VIDEO_GRAPHIC_EXTS = ['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi'] as const

export function isVideoGraphicPath(filePath: string): boolean {
  const low = filePath.toLowerCase()
  return VIDEO_GRAPHIC_EXTS.some((e) => low.endsWith(e))
}

/** Segment `end` for the transcript segment containing a word with this `start` time. */
export function segmentEndForWordAt(
  segments: Array<{
    start: number
    end: number
    words?: Array<{ start: number; end: number; word?: string }>
  }>,
  wordStart: number,
): number | null {
  const eps = 0.03
  for (const seg of segments) {
    for (const w of seg.words ?? []) {
      if (Math.abs(w.start - wordStart) < eps) {
        return seg.end
      }
    }
  }
  return null
}

export type PlacementEndMode = 'word' | 'sentence'

export type WordTrigger = {
  /** Source-time start (first anchor word). */
  start: number
  /** Source-time end (last anchor word end, or segment end in sentence mode). */
  end: number
  startWord: string
  endWord: string
  endMode: PlacementEndMode
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

export function countTimelineEventTypes(events: TimelineEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of events) {
    const t = e.type ?? 'unknown'
    counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

/**
 * Drop caption/graphic SFX markers that would not play in export (mirrors engine/render collect_sfx_plays).
 */
export function filterTimelineSfxForDisplay(
  events: TimelineEvent[],
  sfxCaptionEveryN: number,
  sfxGraphicEveryN: number,
): TimelineEvent[] {
  const capN = sfxCaptionEveryN
  const gfxN = sfxGraphicEveryN
  const idx: Record<string, number> = {}
  const out: TimelineEvent[] = []
  for (const e of events) {
    if (e.type !== 'sfx') {
      out.push(e)
      continue
    }
    const tr = typeof e.trigger === 'string' ? e.trigger : ''
    if (tr !== 'caption_entry' && tr !== 'graphic_entry') {
      out.push(e)
      continue
    }
    idx[tr] = (idx[tr] ?? 0) + 1
    const n = idx[tr]
    if (tr === 'caption_entry' && capN <= 0) {
      continue
    }
    if (tr === 'graphic_entry' && gfxN <= 0) {
      continue
    }
    if (tr === 'caption_entry' && capN > 1 && n % capN !== 0) {
      continue
    }
    if (tr === 'graphic_entry' && gfxN > 1 && n % gfxN !== 0) {
      continue
    }
    out.push(e)
  }
  return out
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
 * Matches sent to export: manual transcript range wins; else engine match by graphic index/path.
 */
export function buildExportMatches(
  graphics: GraphicItem[],
  pipelineMatches: Record<string, unknown>[],
  manual: Record<string, WordTrigger>,
): Record<string, unknown>[] {
  return graphics.map((g, i) => {
    const pl = manual[g.id]
    if (pl) {
      const t0 = pl.start
      const t1 = pl.end > t0 ? pl.end : t0 + 0.2
      return {
        graphic: g.filePath,
        tag: g.tag,
        matched_segment_start: t0,
        matched_segment_end: t1,
        matched_text: `${pl.startWord} → ${pl.endWord}`,
        similarity: 1,
        isVideo: g.kind === 'video',
      }
    }

    const fromEngine = pipelineMatches[i] as { graphic?: string } | undefined
    if (fromEngine && typeof fromEngine.graphic === 'string' && fromEngine.graphic === g.filePath) {
      const row = { ...(pipelineMatches[i] as Record<string, unknown>) }
      row.isVideo = isVideoGraphicPath(g.filePath)
      return row
    }

    const found = pipelineMatches.find(
      (m) => typeof (m as { graphic?: string }).graphic === 'string' && (m as { graphic: string }).graphic === g.filePath,
    )
    if (found) {
      const row = { ...(found as Record<string, unknown>) }
      row.isVideo = isVideoGraphicPath(g.filePath)
      return row
    }

    return {
      graphic: g.filePath,
      tag: g.tag,
      matched_segment_start: 0,
      matched_segment_end: 0,
      matched_text: '',
      similarity: 0,
      isVideo: g.kind === 'video' || isVideoGraphicPath(g.filePath),
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
    eventCounts: countTimelineEventTypes(withAttention),
  }
}
