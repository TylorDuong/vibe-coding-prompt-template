/** Map source (uncut) timestamps to the silence-cut output timeline. Mirrors `engine.render.source_time_to_output`. */

export type KeepSegment = { start: number; end: number }

export function parseKeepSegments(raw: unknown): KeepSegment[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: KeepSegment[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const o = item as Record<string, unknown>
    const s = Number(o.start)
    const e = Number(o.end)
    if (Number.isFinite(s) && Number.isFinite(e)) {
      out.push({ start: s, end: e })
    }
  }
  return out
}

/**
 * Map an interval on the export (output) timeline back to source-time sub-spans inside keep segments.
 * Used to draw face-zoom (and similar) markers on the source-time scrub bar.
 */
export function outputWindowToSourceSpans(
  outStart: number,
  outEnd: number,
  keepSegments: KeepSegment[],
): Array<{ start: number; end: number }> {
  if (!Number.isFinite(outStart) || !Number.isFinite(outEnd) || outEnd <= outStart) {
    return []
  }
  if (keepSegments.length === 0) {
    return [{ start: outStart, end: outEnd }]
  }
  const ordered = [...keepSegments].sort((a, b) => a.start - b.start)
  let acc = 0
  const spans: Array<{ start: number; end: number }> = []
  for (const seg of ordered) {
    const segLen = seg.end - seg.start
    const outSegEnd = acc + segLen
    const overlap0 = Math.max(acc, outStart)
    const overlap1 = Math.min(outSegEnd, outEnd)
    if (overlap0 < overlap1) {
      const src0 = seg.start + (overlap0 - acc)
      const src1 = seg.start + (overlap1 - acc)
      spans.push({ start: src0, end: src1 })
    }
    acc = outSegEnd
  }
  return spans
}

export function sourceTimeToOutput(t: number, keepSegments: KeepSegment[]): number {
  let out = 0
  const ordered = [...keepSegments].sort((a, b) => a.start - b.start)
  for (const seg of ordered) {
    const ks = seg.start
    const ke = seg.end
    if (t <= ks) {
      return out
    }
    if (t < ke) {
      return out + (t - ks)
    }
    out += ke - ks
  }
  return out
}

/** Same clamp as engine export / IPC (`videoSpeed`). Coerces numeric strings. */
export function clampExportVideoSpeed(speed: unknown): number {
  const n = typeof speed === 'number' ? speed : Number(speed)
  if (!Number.isFinite(n)) return 1
  return Math.max(0.25, Math.min(4, n))
}

/**
 * Export timeline seconds (after silence cuts, before tempo) → `<video>.currentTime` on the encoded
 * file (`setpts=PTS/speed` in FFmpeg).
 */
export function outputTimeToEncodedFileSeconds(tOut: number, videoSpeed: number): number {
  const s = clampExportVideoSpeed(videoSpeed)
  return tOut / s
}

/** Expected encoded MP4 duration from cut output length and export speed. */
export function encodedFileDurationSec(outputDurationSec: number, videoSpeed: number): number {
  const s = clampExportVideoSpeed(videoSpeed)
  return outputDurationSec / s
}

/**
 * Map a [start, end) interval on the source timeline to output time after silence cuts.
 * Mirrors `engine.render.remap_interval` (used for graphic overlay enable times in export).
 */
export function remapInterval(
  start: number,
  end: number,
  keepSegments: KeepSegment[],
): { start: number; end: number } | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null
  }
  if (keepSegments.length === 0) {
    return { start, end }
  }
  const t0 = sourceTimeToOutput(start, keepSegments)
  const t1 = sourceTimeToOutput(end, keepSegments)
  if (t1 <= t0) {
    return null
  }
  return { start: t0, end: t1 }
}

export type GraphicMatchLike = {
  graphic: string
  matched_segment_start: number
  matched_segment_end: number
  similarity: number
}

/** Align scrub preview with FFmpeg `between(t,a,b)` (inclusive). */
export const EXPORT_SCRUB_TIME_EPS = 1e-4

/**
 * Which graphic is visible at output time `tOut`, matching export overlay logic
 * (`graphic_display_sec` cap + `remap_interval` per match).
 */
export function activeGraphicMatchAtOutputTime<M extends GraphicMatchLike>(
  tOut: number,
  matches: M[],
  keepSegments: KeepSegment[],
  graphicDisplaySec: number,
): M | null {
  const capSec = Math.max(0.2, Math.min(graphicDisplaySec, 60))
  for (const m of matches) {
    if ((m.similarity ?? 0) < 0.1) continue
    if (typeof m.graphic !== 'string' || m.graphic.length === 0) continue
    const gStart = m.matched_segment_start
    const gEndSrc =
      m.matched_segment_end > m.matched_segment_start
        ? m.matched_segment_end
        : m.matched_segment_start + 3.0
    const span = Math.min(Math.max(0, gEndSrc - gStart), capSec)
    const gEnd = gStart + span
    const r = remapInterval(gStart, gEnd, keepSegments)
    if (r == null) continue
    // FFmpeg overlay enable uses between(t,start,end) (inclusive); stay aligned for scrub preview.
    if (tOut + EXPORT_SCRUB_TIME_EPS >= r.start && tOut <= r.end + EXPORT_SCRUB_TIME_EPS) {
      return m
    }
  }
  return null
}

const END_EPS = 1e-3

/**
 * True if `t` lies in a kept (non-cut) span on the source timeline.
 * Uses half-open [start, end) between segments; the **last** segment treats `t <= end` as inside
 * (with small epsilon) so scrubbing at the final timestamp still shows video.
 * Empty list => true (no cut map).
 */
export function isInsideKeepSegments(t: number, keepSegments: KeepSegment[]): boolean {
  if (keepSegments.length === 0) {
    return true
  }
  const ordered = [...keepSegments].sort((a, b) => a.start - b.start)
  const n = ordered.length
  for (let i = 0; i < n; i++) {
    const seg = ordered[i]
    const ks = seg.start
    const ke = seg.end
    const isLast = i === n - 1
    if (t < ks) {
      continue
    }
    if (t < ke) {
      return true
    }
    if (isLast && t <= ke + END_EPS) {
      return true
    }
  }
  return false
}
