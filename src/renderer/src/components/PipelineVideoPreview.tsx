import {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type RefObject,
} from 'react'
import type { EncodedPreviewState } from '../hooks/useEncodedPreview'
import type { PipelineConfig, PipelinePreviewMeta } from '../hooks/useProcessPipeline'
import type { KeepSegment } from '../lib/timelineRemap'
import {
  captionOutlineShadowCqw,
  captionPreviewFontSizeCss,
} from '../lib/captionPreviewStyle'
import {
  activeGraphicMatchAtOutputTime,
  EXPORT_SCRUB_TIME_EPS,
  graphicMatchRemappedOut,
  isInsideKeepSegments,
  outputTimeToEncodedFileSeconds,
  sourceTimeToOutput,
} from '../lib/timelineRemap'
import { absPathToLocalFileUrl } from '../lib/localFileUrl'

type MatchRow = {
  graphic: string
  matched_segment_start: number
  matched_segment_end: number
  similarity: number
  isVideo?: boolean
}

const ASPECT_WH: Record<
  Exclude<PipelineConfig['outputAspectRatio'], 'original'>,
  { w: number; h: number }
> = {
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '1:1': { w: 1, h: 1 },
  '4:5': { w: 4, h: 5 },
}

function activeCaptionChunk(
  tOut: number,
  chunks: PipelinePreviewMeta['captionChunks'] | null | undefined,
): { text: string } | null {
  if (chunks == null || chunks.length === 0) return null
  for (const c of chunks) {
    if (
      tOut + EXPORT_SCRUB_TIME_EPS >= c.start &&
      tOut <= c.end + EXPORT_SCRUB_TIME_EPS
    ) {
      return { text: c.text }
    }
  }
  return null
}

function zoomActive(
  tOut: number,
  windows: PipelinePreviewMeta['faceZoomWindows'] | null | undefined,
): boolean {
  if (windows == null || windows.length === 0) return false
  return windows.some(
    (w) =>
      tOut + EXPORT_SCRUB_TIME_EPS >= w.start && tOut <= w.end + EXPORT_SCRUB_TIME_EPS,
  )
}

function graphicPositionStyle(pos: PipelineConfig['graphicPosition']): CSSProperties {
  const mPct = 2
  switch (pos) {
    case 'top':
      return { top: `${mPct}%`, left: '50%', transform: 'translateX(-50%)' }
    case 'bottom':
      return { bottom: `${mPct}%`, left: '50%', transform: 'translateX(-50%)' }
    case 'top_left':
      return { top: `${mPct}%`, left: `${mPct}%` }
    case 'top_right':
      return { top: `${mPct}%`, right: `${mPct}%` }
    case 'bottom_left':
      return { bottom: `${mPct}%`, left: `${mPct}%` }
    case 'bottom_right':
      return { bottom: `${mPct}%`, right: `${mPct}%` }
    default:
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }
}

type PipelineVideoPreviewProps = {
  videoPath: string
  scrubTime: number
  config: PipelineConfig
  previewMeta: PipelinePreviewMeta | null | undefined
  keepSegments: KeepSegment[]
  matches: MatchRow[]
  videoRef: RefObject<HTMLVideoElement | null>
  onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  /** Fires when encoded `<video>` reports a finite duration (metadata / durationchange). */
  onEncodedDurationKnown?: () => void
  encodedPreviewPath?: string | null
  encodedPreviewState?: EncodedPreviewState
  encodedPreviewProgress?: number
  encodedPreviewError?: string | null
  encodedPreviewQueued?: boolean
}

export default function PipelineVideoPreview({
  videoPath,
  scrubTime,
  config,
  previewMeta,
  keepSegments,
  matches,
  videoRef,
  onLoadedMetadata,
  onEncodedDurationKnown,
  encodedPreviewPath = null,
  encodedPreviewState = 'idle',
  encodedPreviewProgress = 0,
  encodedPreviewError = null,
  encodedPreviewQueued = false,
}: PipelineVideoPreviewProps): React.JSX.Element {
  const [videoDim, setVideoDim] = useState<{ w: number; h: number } | null>(null)
  const [encodedLoadError, setEncodedLoadError] = useState(false)
  const [encodedSeekSettled, setEncodedSeekSettled] = useState(true)
  const encodedTargetTRef = useRef(0)
  const encodedFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graphicOverlayVideoRef = useRef<HTMLVideoElement | null>(null)

  const { arW, arH } = useMemo(() => {
    if (config.outputAspectRatio === 'original') {
      if (videoDim && videoDim.w > 0 && videoDim.h > 0) {
        return { arW: videoDim.w, arH: videoDim.h }
      }
      return { arW: 16, arH: 9 }
    }
    const o = ASPECT_WH[config.outputAspectRatio]
    return { arW: o.w, arH: o.h }
  }, [config.outputAspectRatio, videoDim])

  const tOut =
    keepSegments.length > 0 ? sourceTimeToOutput(scrubTime, keepSegments) : scrubTime

  const inKept =
    keepSegments.length === 0 || isInsideKeepSegments(scrubTime, keepSegments)

  const cap =
    previewMeta != null ? activeCaptionChunk(tOut, previewMeta.captionChunks) : null
  const gfx = activeGraphicMatchAtOutputTime(tOut, matches ?? [], keepSegments)
  const zoomOn =
    inKept &&
    Boolean(config.faceZoomEnabled) &&
    previewMeta != null &&
    zoomActive(tOut, previewMeta.faceZoomWindows)
  const zStrength = previewMeta?.faceZoomStrengthPreview ?? 1
  const scale = zoomOn ? zStrength : 1
  const fc = previewMeta?.faceCenter
  const origin = fc != null ? `${fc.x * 100}% ${fc.y * 100}%` : '50% 50%'

  const wPct = Math.max(10, Math.min(100, config.graphicWidthPercent))

  const shadow = captionOutlineShadowCqw(
    config.captionBorderWidth,
    config.captionOutlineColor,
  )
  const isCenter = config.captionPosition === 'center'

  const encodeReady =
    encodedPreviewState === 'ready' &&
    typeof encodedPreviewPath === 'string' &&
    encodedPreviewPath.length > 0

  const preferEncoded = encodeReady && !encodedLoadError

  useEffect(() => {
    const v = graphicOverlayVideoRef.current
    if (!v || gfx == null || !gfx.isVideo) return
    const r = graphicMatchRemappedOut(gfx, keepSegments)
    if (r == null) return
    const elapsed = Math.max(0, tOut - r.start)
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
    if (dur > 0 && elapsed >= dur - 0.04) {
      v.currentTime = Math.max(0, dur - 0.04)
    } else if (dur > 0) {
      v.currentTime = Math.min(elapsed, dur - 1e-3)
    } else {
      v.currentTime = elapsed
    }
    v.pause()
  }, [gfx, tOut, keepSegments])

  useEffect(() => {
    setEncodedLoadError(false)
  }, [encodedPreviewPath])

  useEffect(() => {
    encodedTargetTRef.current = preferEncoded
      ? outputTimeToEncodedFileSeconds(tOut, config.videoSpeed)
      : tOut
  }, [tOut, preferEncoded, config.videoSpeed])

  useEffect(() => {
    if (!preferEncoded) {
      setEncodedSeekSettled(true)
      return
    }
    setEncodedSeekSettled(false)
    if (encodedFallbackTimerRef.current) {
      clearTimeout(encodedFallbackTimerRef.current)
    }
    encodedFallbackTimerRef.current = setTimeout(() => {
      setEncodedSeekSettled(true)
      encodedFallbackTimerRef.current = null
    }, 650)
    return () => {
      if (encodedFallbackTimerRef.current) {
        clearTimeout(encodedFallbackTimerRef.current)
        encodedFallbackTimerRef.current = null
      }
    }
  }, [tOut, preferEncoded, config.videoSpeed])

  const onEncodedSeeking = useCallback(() => {
    if (!preferEncoded) return
    setEncodedSeekSettled(false)
  }, [preferEncoded])

  const onEncodedSeeked = useCallback(() => {
    if (!preferEncoded) return
    if (encodedFallbackTimerRef.current) {
      clearTimeout(encodedFallbackTimerRef.current)
      encodedFallbackTimerRef.current = null
    }
    const v = videoRef.current
    if (v && Math.abs(v.currentTime - encodedTargetTRef.current) < 0.28) {
      setEncodedSeekSettled(true)
    }
  }, [preferEncoded, videoRef])

  const notifyEncodedDuration = useCallback(
    (v: HTMLVideoElement): void => {
      if (
        preferEncoded &&
        Number.isFinite(v.duration) &&
        v.duration > 0 &&
        v.duration !== Number.POSITIVE_INFINITY
      ) {
        onEncodedDurationKnown?.()
      }
    },
    [preferEncoded, onEncodedDurationKnown],
  )

  const handleMeta = (e: React.SyntheticEvent<HTMLVideoElement>): void => {
    const v = e.currentTarget
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoDim({ w: v.videoWidth, h: v.videoHeight })
    }
    onLoadedMetadata?.(e)
    notifyEncodedDuration(v)
  }

  const handleEncodedDurationChange = (e: React.SyntheticEvent<HTMLVideoElement>): void => {
    notifyEncodedDuration(e.currentTarget)
  }

  const frameStyle: CSSProperties = {
    height: 'min(40vh, 360px)',
    width: `min(100%, calc(min(40vh, 360px) * ${arW} / ${arH}))`,
    containerType: 'size',
  }

  const showEncodedHtmlOverlays = preferEncoded && !encodedSeekSettled
  const showCompositeOverlays = !preferEncoded
  const showAnyOverlay = showCompositeOverlays || showEncodedHtmlOverlays

  return (
    <div className="flex w-full flex-col items-center gap-1.5 px-1">
      <p className="text-[10px] text-zinc-500">
        {preferEncoded
          ? 'Export-accurate preview (12 fps, ≤480px wide, frequent keyframes for fast scrub). While the frame catches up, the last image is blurred and captions/graphics follow the playhead.'
          : encodedPreviewQueued
            ? 'Queued export-accurate preview — starting low-res encode in a moment…'
            : encodedPreviewState === 'encoding'
              ? `Building export-accurate preview… ${encodedPreviewProgress}%`
              : encodeReady && encodedLoadError
                ? 'Encoded preview failed to load — showing live composite below.'
                : encodedPreviewError != null && encodedPreviewError.length > 0
                  ? `Live preview (export encode failed: ${encodedPreviewError})`
                  : 'Live composite preview; export-accurate encode runs after processing finishes.'}
      </p>
      {encodedPreviewQueued || encodedPreviewState === 'encoding' ? (
        <div className="h-1 w-full max-w-md overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full transition-[width] duration-300 ${
              encodedPreviewQueued ? 'w-1/3 animate-pulse bg-zinc-600' : 'bg-emerald-600'
            }`}
            style={
              encodedPreviewQueued
                ? undefined
                : { width: `${encodedPreviewProgress}%` }
            }
          />
        </div>
      ) : null}
      <div
        className="relative overflow-hidden rounded-lg border border-zinc-700 bg-black shadow-md"
        style={frameStyle}
      >
        {preferEncoded ? (
          <video
            key={encodedPreviewPath}
            ref={videoRef}
            src={absPathToLocalFileUrl(encodedPreviewPath)}
            className={`absolute inset-0 z-0 h-full w-full bg-black object-contain transition-[filter,transform] duration-150 ease-out ${
              !encodedSeekSettled ? 'scale-[1.04] blur-md' : 'blur-0'
            }`}
            playsInline
            preload="auto"
            onLoadedMetadata={handleMeta}
            onDurationChange={handleEncodedDurationChange}
            onSeeking={onEncodedSeeking}
            onSeeked={onEncodedSeeked}
            onError={() => setEncodedLoadError(true)}
          />
        ) : (
          <>
            <div
              className="absolute inset-0 z-0 overflow-hidden"
              style={{
                transform: `scale(${scale})`,
                transformOrigin: origin,
              }}
            >
              <video
                ref={videoRef}
                src={absPathToLocalFileUrl(videoPath)}
                className="absolute inset-0 h-full w-full object-cover"
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={handleMeta}
              />
            </div>

            {!inKept ? (
              <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1 bg-zinc-950 px-3 text-center">
                <span className="text-[10px] font-medium text-zinc-400">
                  Removed in export (silence gap)
                </span>
                <span className="font-mono text-[9px] text-zinc-600">out ≈ {tOut.toFixed(2)}s</span>
              </div>
            ) : null}
          </>
        )}

        {showAnyOverlay && gfx != null ? (
          gfx.isVideo ? (
            <video
              ref={graphicOverlayVideoRef}
              src={absPathToLocalFileUrl(gfx.graphic)}
              className={`pointer-events-none absolute object-contain ${
                showEncodedHtmlOverlays ? 'z-[15]' : 'z-[5]'
              }`}
              style={{
                ...graphicPositionStyle(config.graphicPosition),
                width: `${wPct}%`,
                maxWidth: `${wPct}%`,
                maxHeight: '42cqh',
              }}
              muted
              playsInline
              preload="auto"
            />
          ) : (
            <img
              src={absPathToLocalFileUrl(gfx.graphic)}
              alt=""
              className={`pointer-events-none absolute object-contain ${
                showEncodedHtmlOverlays ? 'z-[15]' : 'z-[5]'
              }`}
              style={{
                ...graphicPositionStyle(config.graphicPosition),
                width: `${wPct}%`,
                maxWidth: `${wPct}%`,
                maxHeight: '42cqh',
              }}
            />
          )
        ) : null}

        {showAnyOverlay && cap != null ? (
          <div
            className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center ${
              isCenter ? 'top-1/2 -translate-y-1/2' : ''
            }`}
            style={
              isCenter
                ? { paddingLeft: '2cqw', paddingRight: '2cqw' }
                : { bottom: 'max(6px, 2cqh)', paddingLeft: '2cqw', paddingRight: '2cqw' }
            }
          >
            <span
              className="inline-block max-w-[min(96%,calc(100cqw-4cqw))] text-center leading-tight break-words whitespace-pre-wrap drop-shadow-md"
              style={{
                fontSize: captionPreviewFontSizeCss(config.captionFontSize),
                color: config.captionFontColor,
                fontWeight: config.captionBold ? 700 : 400,
                textShadow: shadow,
                backgroundColor: config.captionBox ? 'rgba(0,0,0,0.55)' : undefined,
                padding: config.captionBox ? '0.35em 0.75em' : undefined,
                borderRadius: config.captionBox ? 6 : undefined,
              }}
            >
              {cap.text}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
