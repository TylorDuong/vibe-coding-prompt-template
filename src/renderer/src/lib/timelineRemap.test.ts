import { describe, expect, it } from 'vitest'
import {
  activeGraphicMatchAtOutputTime,
  clampExportVideoSpeed,
  encodedFileDurationSec,
  isInsideKeepSegments,
  outputTimeToEncodedFileSeconds,
  outputWindowToSourceSpans,
  parseKeepSegments,
  remapInterval,
  sourceTimeToOutput,
} from './timelineRemap'

describe('sourceTimeToOutput', () => {
  it('maps through a removed gap', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ]
    expect(sourceTimeToOutput(1, keep)).toBe(1)
    expect(sourceTimeToOutput(5, keep)).toBe(2)
    expect(sourceTimeToOutput(6, keep)).toBe(3)
  })

  it('handles single kept span', () => {
    expect(sourceTimeToOutput(2.5, [{ start: 0, end: 10 }])).toBe(2.5)
  })
})

describe('isInsideKeepSegments', () => {
  it('is false in gap between two kept spans', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ]
    expect(isInsideKeepSegments(1, keep)).toBe(true)
    expect(isInsideKeepSegments(3, keep)).toBe(false)
    expect(isInsideKeepSegments(6, keep)).toBe(true)
  })

  it('treats end of the final keep span as inside so scrub at duration still shows video', () => {
    expect(isInsideKeepSegments(2, [{ start: 0, end: 2 }])).toBe(true)
    expect(isInsideKeepSegments(1.999, [{ start: 0, end: 2 }])).toBe(true)
  })

  it('treats end of a non-final keep span as outside (half-open)', () => {
    expect(
      isInsideKeepSegments(2, [
        { start: 0, end: 2 },
        { start: 5, end: 8 },
      ]),
    ).toBe(false)
  })

  it('returns true when no keep segments', () => {
    expect(isInsideKeepSegments(100, [])).toBe(true)
  })
})

describe('remapInterval', () => {
  it('matches engine remap_interval across silence gaps', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 5, end: 10 },
    ]
    expect(remapInterval(0.5, 1.5, keep)).toEqual({ start: 0.5, end: 1.5 })
    expect(remapInterval(2, 3, keep)).toBeNull()
  })

  it('returns source interval when there are no keep segments', () => {
    expect(remapInterval(2, 5, [])).toEqual({ start: 2, end: 5 })
  })
})

describe('activeGraphicMatchAtOutputTime', () => {
  it('uses full matched span on output timeline like export', () => {
    const keep = [{ start: 0, end: 10 }]
    const m = {
      graphic: '/g.png',
      matched_segment_start: 2,
      matched_segment_end: 10,
      similarity: 1,
    }
    expect(activeGraphicMatchAtOutputTime(3, [m], keep)).toEqual(m)
    expect(activeGraphicMatchAtOutputTime(9, [m], keep)).toEqual(m)
    expect(activeGraphicMatchAtOutputTime(10.02, [m], keep)).toBeNull()
  })
})

describe('outputTimeToEncodedFileSeconds', () => {
  it('maps export timeline to file time using speed', () => {
    expect(outputTimeToEncodedFileSeconds(20, 2)).toBe(10)
    expect(outputTimeToEncodedFileSeconds(20, 0.5)).toBe(40)
    expect(encodedFileDurationSec(60, 2)).toBe(30)
  })

  it('coerces numeric string speed', () => {
    expect(clampExportVideoSpeed('2')).toBe(2)
  })
})

describe('outputWindowToSourceSpans', () => {
  it('maps output intervals back across silence gaps', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ]
    // Output 0–2 is first segment only; 2–5 is second
    expect(outputWindowToSourceSpans(0, 1.5, keep)).toEqual([{ start: 0, end: 1.5 }])
    expect(outputWindowToSourceSpans(2, 3.5, keep)).toEqual([{ start: 5, end: 6.5 }])
  })

  it('returns source range when there are no keep segments', () => {
    expect(outputWindowToSourceSpans(1, 3, [])).toEqual([{ start: 1, end: 3 }])
  })

  it('returns empty for invalid window', () => {
    expect(outputWindowToSourceSpans(2, 2, [{ start: 0, end: 10 }])).toEqual([])
  })
})

describe('parseKeepSegments', () => {
  it('parses valid array', () => {
    expect(parseKeepSegments([{ start: 0, end: 1 }])).toEqual([{ start: 0, end: 1 }])
  })

  it('returns empty for invalid input', () => {
    expect(parseKeepSegments(null)).toEqual([])
  })
})
