import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIPELINE_CONFIG,
  mergePipelineConfigFromUnknown,
  parsePipelinePresetJson,
  serializePipelinePreset,
  SPLITTY_PRESET_VERSION,
} from './pipelineConfigPreset'

describe('pipelineConfigPreset', () => {
  it('roundtrips through JSON', () => {
    const json = serializePipelinePreset(DEFAULT_PIPELINE_CONFIG)
    const r = parsePipelinePresetJson(json)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config).toEqual(DEFAULT_PIPELINE_CONFIG)
    }
  })

  it('parses v1 wrapper', () => {
    const raw = {
      splittyPresetVersion: SPLITTY_PRESET_VERSION,
      pipelineConfig: { maxWords: 5, captionPosition: 'center' as const },
    }
    const r = parsePipelinePresetJson(JSON.stringify(raw))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.maxWords).toBe(5)
      expect(r.config.captionPosition).toBe('center')
      expect(r.config.silenceThresholdDb).toBe(DEFAULT_PIPELINE_CONFIG.silenceThresholdDb)
    }
  })

  it('merges flat legacy object', () => {
    const r = parsePipelinePresetJson(JSON.stringify({ maxWords: 1 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.maxWords).toBe(1)
    }
  })

  it('mergePipelineConfigFromUnknown clamps bad numbers', () => {
    const c = mergePipelineConfigFromUnknown({ maxWords: 999, captionFontColor: 'not-a-color' })
    expect(c.maxWords).toBe(20)
    expect(c.captionFontColor).toBe('#FFFFFF')
  })
})
