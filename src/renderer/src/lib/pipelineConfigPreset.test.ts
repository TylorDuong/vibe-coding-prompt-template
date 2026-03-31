import { cloneDefaultSfxSlots } from '../components/SfxPoolPanel'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIPELINE_CONFIG,
  mergePipelineConfigFromUnknown,
  parsePipelinePresetJson,
  serializeSplittyPreset,
  SPLITTY_PRESET_VERSION,
  SPLITTY_PRESET_VERSION_LEGACY,
} from './pipelineConfigPreset'

describe('pipelineConfigPreset', () => {
  it('roundtrips through JSON', () => {
    const slots = cloneDefaultSfxSlots()
    const json = serializeSplittyPreset(DEFAULT_PIPELINE_CONFIG, slots)
    const r = parsePipelinePresetJson(json)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config).toEqual(DEFAULT_PIPELINE_CONFIG)
      expect(r.sfxSlots).not.toBeNull()
      expect(r.sfxSlots?.map((s) => s.id)).toEqual(slots.map((s) => s.id))
    }
  })

  it('parses v1 wrapper', () => {
    const raw = {
      splittyPresetVersion: SPLITTY_PRESET_VERSION_LEGACY,
      pipelineConfig: { maxWords: 5, captionPosition: 'center' as const },
    }
    const r = parsePipelinePresetJson(JSON.stringify(raw))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.maxWords).toBe(5)
      expect(r.config.captionPosition).toBe('center')
      expect(r.config.silenceThresholdDb).toBe(DEFAULT_PIPELINE_CONFIG.silenceThresholdDb)
      expect(r.sfxSlots).toBeNull()
    }
  })

  it('merges flat legacy object', () => {
    const r = parsePipelinePresetJson(JSON.stringify({ maxWords: 1 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.maxWords).toBe(1)
      expect(r.sfxSlots).toBeNull()
    }
  })

  it('parses v2 with sfxSlots', () => {
    const slots = cloneDefaultSfxSlots()
    slots[0] = { ...slots[0], label: 'Renamed whoosh' }
    const raw = {
      splittyPresetVersion: SPLITTY_PRESET_VERSION,
      pipelineConfig: {},
      sfxSlots: slots,
    }
    const r = parsePipelinePresetJson(JSON.stringify(raw))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sfxSlots?.[0]?.label).toBe('Renamed whoosh')
    }
  })

  it('mergePipelineConfigFromUnknown clamps bad numbers', () => {
    const c = mergePipelineConfigFromUnknown({ maxWords: 999, captionFontColor: 'not-a-color' })
    expect(c.maxWords).toBe(20)
    expect(c.captionFontColor).toBe('#FFFFFF')
  })
})
