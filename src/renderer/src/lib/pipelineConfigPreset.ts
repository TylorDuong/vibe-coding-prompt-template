/**
 * JSON import/export for Processing + Caption & export options (`PipelineConfig`).
 *
 * **When you add or remove a `PipelineConfig` field, you must also:**
 * 1. Update `DEFAULT_PIPELINE_CONFIG` and `mergePipelineConfigFromUnknown` in this file.
 * 2. Update engine sanitization in `engine/main.py` (`exportFull`) and IPC in `src/main/ipcHandlers.ts`.
 * 3. Update manual / preset notes in `OVERLAY-TEST-CHECKLIST.md` (Config preset + enhancement rows).
 */

import type {
  CaptionPosition,
  GraphicMotion,
  GraphicPosition,
  PipelineConfig,
} from '../hooks/useProcessPipeline'

/** Bump when the preset file shape or merge rules change incompatibly. */
export const SPLITTY_PRESET_VERSION = 1 as const

export type SplittyPresetFileV1 = {
  splittyPresetVersion: typeof SPLITTY_PRESET_VERSION
  /** App version label for humans only (optional). */
  app?: string
  pipelineConfig: Record<string, unknown>
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  silenceThresholdDb: -40,
  minSilenceDurationMs: 800,
  paddingMs: 200,
  mergeGapMs: 300,
  minKeepMs: 150,
  attentionLengthMs: 3000,
  maxWords: 3,
  graphicDisplaySec: 2,
  graphicWidthPercent: 85,
  captionFontSize: 28,
  captionFontColor: '#FFFFFF',
  captionPosition: 'bottom',
  captionBold: false,
  captionBox: false,
  captionBorderWidth: 2,
  captionFadeInSec: 0,
  captionFadeOutSec: 0,
  graphicPosition: 'center',
  graphicMotion: 'none',
  graphicAnimInSec: 0.25,
  sfxCaptionEveryN: 1,
  sfxGraphicEveryN: 1,
  graphicFadeInSec: 0,
  graphicFadeOutSec: 0,
  faceZoomEnabled: false,
  faceZoomIntervalSec: 3,
  faceZoomPulseSec: 0.35,
  faceZoomStrength: 0.12,
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function pickCaptionPosition(raw: unknown): CaptionPosition {
  return raw === 'center' ? 'center' : 'bottom'
}

function pickGraphicPosition(raw: unknown): GraphicPosition {
  const allowed: GraphicPosition[] = [
    'center',
    'top',
    'bottom',
    'top_right',
    'top_left',
    'bottom_right',
    'bottom_left',
  ]
  return typeof raw === 'string' && (allowed as string[]).includes(raw)
    ? (raw as GraphicPosition)
    : 'center'
}

function pickGraphicMotion(raw: unknown): GraphicMotion {
  return raw === 'slide_in' ? 'slide_in' : 'none'
}

function pickHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') {
    return fallback
  }
  const h = raw.trim()
  return /^#[0-9A-Fa-f]{6}$/.test(h) ? h.toUpperCase() : fallback
}

/**
 * Merge a loose `pipelineConfig` object from JSON onto defaults (unknown keys ignored).
 */
export function mergePipelineConfigFromUnknown(
  partial: Record<string, unknown>,
  defaults: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
): PipelineConfig {
  const g = (k: keyof PipelineConfig): unknown => partial[k as string]

  return {
    silenceThresholdDb: clamp(
      typeof g('silenceThresholdDb') === 'number' ? g('silenceThresholdDb') as number : defaults.silenceThresholdDb,
      -60,
      -10,
    ),
    minSilenceDurationMs: clamp(
      typeof g('minSilenceDurationMs') === 'number'
        ? (g('minSilenceDurationMs') as number)
        : defaults.minSilenceDurationMs,
      200,
      3000,
    ),
    paddingMs: clamp(
      typeof g('paddingMs') === 'number' ? (g('paddingMs') as number) : defaults.paddingMs,
      0,
      500,
    ),
    mergeGapMs: clamp(
      typeof g('mergeGapMs') === 'number' ? (g('mergeGapMs') as number) : defaults.mergeGapMs,
      0,
      1000,
    ),
    minKeepMs: clamp(
      typeof g('minKeepMs') === 'number' ? (g('minKeepMs') as number) : defaults.minKeepMs,
      0,
      500,
    ),
    attentionLengthMs: clamp(
      typeof g('attentionLengthMs') === 'number'
        ? (g('attentionLengthMs') as number)
        : defaults.attentionLengthMs,
      500,
      60000,
    ),
    maxWords: clamp(
      typeof g('maxWords') === 'number' ? (g('maxWords') as number) : defaults.maxWords,
      1,
      20,
    ),
    graphicDisplaySec: clamp(
      typeof g('graphicDisplaySec') === 'number'
        ? (g('graphicDisplaySec') as number)
        : defaults.graphicDisplaySec,
      0.5,
      30,
    ),
    graphicWidthPercent: clamp(
      typeof g('graphicWidthPercent') === 'number'
        ? (g('graphicWidthPercent') as number)
        : defaults.graphicWidthPercent,
      10,
      100,
    ),
    captionFontSize: clamp(
      typeof g('captionFontSize') === 'number'
        ? (g('captionFontSize') as number)
        : defaults.captionFontSize,
      12,
      120,
    ),
    captionFontColor: pickHexColor(g('captionFontColor'), defaults.captionFontColor),
    captionPosition: pickCaptionPosition(g('captionPosition')),
    captionBold: typeof g('captionBold') === 'boolean' ? g('captionBold') as boolean : defaults.captionBold,
    captionBox: typeof g('captionBox') === 'boolean' ? g('captionBox') as boolean : defaults.captionBox,
    captionBorderWidth: clamp(
      typeof g('captionBorderWidth') === 'number'
        ? (g('captionBorderWidth') as number)
        : defaults.captionBorderWidth,
      0,
      8,
    ),
    captionFadeInSec: clamp(
      typeof g('captionFadeInSec') === 'number'
        ? (g('captionFadeInSec') as number)
        : defaults.captionFadeInSec,
      0,
      2,
    ),
    captionFadeOutSec: clamp(
      typeof g('captionFadeOutSec') === 'number'
        ? (g('captionFadeOutSec') as number)
        : defaults.captionFadeOutSec,
      0,
      2,
    ),
    graphicPosition: pickGraphicPosition(g('graphicPosition')),
    graphicMotion: pickGraphicMotion(g('graphicMotion')),
    graphicAnimInSec: clamp(
      typeof g('graphicAnimInSec') === 'number'
        ? (g('graphicAnimInSec') as number)
        : defaults.graphicAnimInSec,
      0,
      3,
    ),
    sfxCaptionEveryN: clamp(
      typeof g('sfxCaptionEveryN') === 'number'
        ? (g('sfxCaptionEveryN') as number)
        : defaults.sfxCaptionEveryN,
      1,
      20,
    ),
    sfxGraphicEveryN: clamp(
      typeof g('sfxGraphicEveryN') === 'number'
        ? (g('sfxGraphicEveryN') as number)
        : defaults.sfxGraphicEveryN,
      1,
      20,
    ),
    graphicFadeInSec: clamp(
      typeof g('graphicFadeInSec') === 'number'
        ? (g('graphicFadeInSec') as number)
        : defaults.graphicFadeInSec,
      0,
      5,
    ),
    graphicFadeOutSec: clamp(
      typeof g('graphicFadeOutSec') === 'number'
        ? (g('graphicFadeOutSec') as number)
        : defaults.graphicFadeOutSec,
      0,
      5,
    ),
    faceZoomEnabled:
      typeof g('faceZoomEnabled') === 'boolean'
        ? (g('faceZoomEnabled') as boolean)
        : defaults.faceZoomEnabled,
    faceZoomIntervalSec: clamp(
      typeof g('faceZoomIntervalSec') === 'number'
        ? (g('faceZoomIntervalSec') as number)
        : defaults.faceZoomIntervalSec,
      0.5,
      30,
    ),
    faceZoomPulseSec: clamp(
      typeof g('faceZoomPulseSec') === 'number'
        ? (g('faceZoomPulseSec') as number)
        : defaults.faceZoomPulseSec,
      0.05,
      2,
    ),
    faceZoomStrength: clamp(
      typeof g('faceZoomStrength') === 'number'
        ? (g('faceZoomStrength') as number)
        : defaults.faceZoomStrength,
      0,
      0.45,
    ),
  }
}

export function serializePipelinePreset(config: PipelineConfig, appVersion?: string): string {
  const doc: SplittyPresetFileV1 = {
    splittyPresetVersion: SPLITTY_PRESET_VERSION,
    ...(appVersion ? { app: appVersion } : {}),
    pipelineConfig: { ...config },
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

export function parsePipelinePresetJson(
  jsonText: string,
  defaults: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
): { ok: true; config: PipelineConfig } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText) as unknown
  } catch {
    return { ok: false, error: 'File is not valid JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Preset root must be an object.' }
  }
  const root = parsed as Record<string, unknown>
  if (root.splittyPresetVersion === SPLITTY_PRESET_VERSION) {
    const pc = root.pipelineConfig
    if (typeof pc !== 'object' || pc === null) {
      return { ok: false, error: 'Missing pipelineConfig object.' }
    }
    return { ok: true, config: mergePipelineConfigFromUnknown(pc as Record<string, unknown>, defaults) }
  }
  // Legacy: a flat `PipelineConfig`-shaped object
  if (
    typeof root.silenceThresholdDb === 'number' ||
    typeof root.maxWords === 'number' ||
    typeof root.captionFontSize === 'number'
  ) {
    return { ok: true, config: mergePipelineConfigFromUnknown(root, defaults) }
  }
  return {
    ok: false,
    error: `Missing splittyPresetVersion: ${SPLITTY_PRESET_VERSION} (or a flat pipeline config object).`,
  }
}
