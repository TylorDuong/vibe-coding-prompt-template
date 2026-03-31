"""Engine CLI — JSON-over-stdin/stdout protocol for Electron IPC bridge.

Reads one JSON object per line from stdin, dispatches to the appropriate
module, and writes one JSON response per line to stdout.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from engine.result import EngineResult
from engine.validation import validate_video_path, validate_output_path, sanitize_number
from engine.video import (
    validate_input, detect_silence, cut_silences, generate_thumbnail,
    _invert_silences, _pad_segments, _merge_close_segments, _drop_tiny_segments,
)
from engine.transcribe import transcribe
from engine.transcript_merge import merge_transcript_segments
from engine.match import semantic_match
from engine.polish import build_events
from engine.render import (
    build_caption_chunks,
    normalize_graphic_motion,
    output_cropped_dimensions,
    remap_caption_chunks,
    render_full,
    wrap_caption_chunks_for_frame,
)
from engine.face_zoom import (
    compute_zoom_windows_output,
    graphic_overlay_intervals_output,
    sample_face_center_normalized,
)


def _sanitize_hex_color(value: object, default: str = "FFFFFF") -> str:
    if not isinstance(value, str):
        return default
    h = value.strip().lstrip("#")
    if len(h) == 6 and all(c in "0123456789abcdefABCDEF" for c in h):
        return h.upper()
    return default


def _sanitize_choice(value: object, allowed: set[str], default: str) -> str:
    if isinstance(value, str) and value in allowed:
        return value
    return default


def _parse_sfx_assignments_message(raw: object) -> list[dict[str, Any]] | None:
    if not isinstance(raw, list):
        return None
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        tr = item.get("trigger")
        fp = item.get("filePath")
        if not isinstance(tr, str) or not isinstance(fp, str):
            continue
        vol = sanitize_number(item.get("volume"), 0.0, 2.0, 1.0)
        out.append({"trigger": tr, "filePath": fp, "volume": float(vol)})
    return out if out else None


def handle(message: dict) -> EngineResult:
    command = message.get("command")

    if command == "health":
        return EngineResult(ok=True, data={"status": "ok"})

    if command == "ingest":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        return validate_input(video_path)

    if command == "thumbnail":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        return generate_thumbnail(video_path)

    if command == "detectSilence":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        return detect_silence(
            video_path,
            silence_threshold_db=int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -30)),
            min_silence_duration_ms=int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 500)),
        )

    if command == "cutSilences":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        output_path = message.get("outputPath")
        if output_path:
            out_err = validate_output_path(output_path)
            if out_err:
                return out_err
        return cut_silences(
            video_path,
            output_path=output_path,
            silence_threshold_db=int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -30)),
            min_silence_duration_ms=int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 500)),
        )

    if command == "process":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err

        graphics = message.get("graphics", [])
        if not isinstance(graphics, list):
            graphics = []

        silence_db = int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -40))
        silence_ms = int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 800))
        padding_ms = int(sanitize_number(message.get("paddingMs"), 0, 1000, 200))
        merge_gap_ms = int(sanitize_number(message.get("mergeGapMs"), 0, 2000, 300))
        min_keep_ms = int(sanitize_number(message.get("minKeepMs"), 0, 1000, 150))
        attention_ms = int(sanitize_number(message.get("attentionLengthMs"), 500, 60000, 3000))
        max_words = int(sanitize_number(message.get("maxWords"), 1, 20, 3))
        caption_font_preview = int(sanitize_number(message.get("captionFontSize"), 12, 120, 24))
        caption_bold_preview = bool(message.get("captionBold"))
        output_aspect_preview = _sanitize_choice(
            message.get("outputAspectRatio"),
            {"original", "16:9", "9:16", "1:1", "4:5"},
            "original",
        )
        face_zoom_preview = bool(message.get("faceZoomEnabled"))
        face_zoom_iv = float(sanitize_number(message.get("faceZoomIntervalSec"), 0.5, 30.0, 3.0))
        face_zoom_pulse = float(sanitize_number(message.get("faceZoomPulseSec"), 0.05, 2.0, 0.35))
        face_zoom_str = float(sanitize_number(message.get("faceZoomStrength"), 0.0, 0.45, 0.12))

        ingest_result = validate_input(video_path)
        if not ingest_result.ok:
            return ingest_result

        ingest_duration = float((ingest_result.data or {}).get("duration", 0) or 0)
        total_duration = float(sanitize_number(message.get("totalDuration"), 0, 86400 * 4, 0))
        if total_duration <= 0:
            total_duration = ingest_duration

        pre_silences = message.get("silences")
        if isinstance(pre_silences, list):
            silences = []
            for item in pre_silences:
                if not isinstance(item, dict):
                    continue
                try:
                    silences.append({
                        "start": float(item["start"]),
                        "end": float(item["end"]),
                    })
                except (KeyError, TypeError, ValueError):
                    continue
        else:
            silence_result = detect_silence(
                video_path, silence_threshold_db=silence_db, min_silence_duration_ms=silence_ms
            )
            silences = silence_result.data.get("silences", []) if silence_result.ok and silence_result.data else []

        transcript_result = transcribe(video_path)
        if not transcript_result.ok:
            return transcript_result

        raw_segments = transcript_result.data["segments"] if transcript_result.data else []
        segments = merge_transcript_segments(raw_segments)
        matches_list: list = []
        if graphics:
            match_result = semantic_match(segments, graphics)
            if match_result.ok and match_result.data:
                matches_list = match_result.data["matches"]

        polish_result = build_events(
            segments=segments,
            matches=matches_list,
            silences=silences,
            total_duration=total_duration,
            attention_length_ms=attention_ms,
        )
        events = polish_result.data["events"] if polish_result.ok and polish_result.data else []
        event_counts = polish_result.data.get("event_counts", {}) if polish_result.ok and polish_result.data else {}

        keep_segments = _invert_silences(silences, total_duration)
        keep_segments = _pad_segments(keep_segments, padding_ms / 1000.0, total_duration)
        keep_segments = _merge_close_segments(keep_segments, merge_gap_ms / 1000.0)
        keep_segments = _drop_tiny_segments(keep_segments, min_keep_ms / 1000.0)
        if not keep_segments:
            keep_segments = [{"start": 0.0, "end": total_duration}]

        out_dur = sum(float(s["end"]) - float(s["start"]) for s in keep_segments)
        cap_chunks = remap_caption_chunks(
            build_caption_chunks(segments, max_words),
            keep_segments,
        )
        cw_prev, _ch_prev = output_cropped_dimensions(video_path, output_aspect_preview)
        cap_wrapped = wrap_caption_chunks_for_frame(
            cap_chunks,
            cw_prev,
            48,
            caption_font_preview,
            caption_bold_preview,
        )
        caption_preview_chunks = [
            {"text": str(c.get("text", "")), "start": float(c["start"]), "end": float(c["end"])}
            for c in cap_wrapped
        ]
        giv = graphic_overlay_intervals_output(matches_list, keep_segments)
        graphic_preview_intervals = [{"start": a, "end": b} for a, b in giv]
        face_center_preview: dict[str, float] | None = None
        zoom_windows_preview: list[dict[str, float]] = []
        zf_preview = 1.0 + max(0.0, min(float(face_zoom_str), 0.45)) if face_zoom_preview else 1.0
        if face_zoom_preview:
            fc = sample_face_center_normalized(video_path)
            if fc:
                face_center_preview = {"x": float(fc[0]), "y": float(fc[1])}
            zw = compute_zoom_windows_output(
                out_dur,
                max(0.5, float(face_zoom_iv)),
                max(0.05, min(float(face_zoom_pulse), 2.0)),
                giv,
            )
            zoom_windows_preview = [{"start": float(a), "end": float(b)} for a, b in zw]

        preview_meta = {
            "outputDurationSec": round(out_dur, 4),
            "captionChunks": caption_preview_chunks,
            "graphicIntervalsOutput": graphic_preview_intervals,
            "faceCenter": face_center_preview,
            "faceZoomWindows": zoom_windows_preview,
            "faceZoomStrengthPreview": round(zf_preview, 4),
        }

        return EngineResult(
            ok=True,
            data={
                "timeline": {
                    "video": ingest_result.data,
                    "segments": segments,
                    "matches": matches_list,
                    "silences": silences,
                    "silenceThresholdMs": silence_ms,
                    "events": events,
                    "eventCounts": event_counts,
                    "keepSegments": keep_segments,
                    "preview": preview_meta,
                }
            },
        )

    if command == "exportFull":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        output_path = message.get("outputPath", "")
        out_err = validate_output_path(output_path)
        if out_err:
            return out_err

        segments = message.get("segments", [])
        matches = message.get("matches", [])
        sfx_pool = message.get("sfxPool", {})
        sfx_assignments = _parse_sfx_assignments_message(message.get("sfxAssignments"))
        max_words = int(sanitize_number(message.get("maxWords"), 1, 20, 3))
        silence_db = int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -40))
        silence_ms = int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 800))
        padding_ms = int(sanitize_number(message.get("paddingMs"), 0, 1000, 200))
        merge_gap_ms = int(sanitize_number(message.get("mergeGapMs"), 0, 2000, 300))
        min_keep_ms = int(sanitize_number(message.get("minKeepMs"), 0, 1000, 150))
        attention_ms = int(sanitize_number(message.get("attentionLengthMs"), 500, 60000, 3000))
        graphic_w_pct = float(sanitize_number(message.get("graphicWidthPercent"), 10.0, 100.0, 85.0))
        graphic_width_frac = graphic_w_pct / 100.0
        caption_font_size = int(sanitize_number(message.get("captionFontSize"), 12, 120, 24))
        caption_font_color = _sanitize_hex_color(message.get("captionFontColor"), "FFFFFF")
        caption_outline_color = _sanitize_hex_color(
            message.get("captionOutlineColor"), "000000"
        )
        caption_position = _sanitize_choice(
            message.get("captionPosition"), {"bottom", "center"}, "bottom"
        )
        caption_bold = bool(message.get("captionBold"))
        caption_box = bool(message.get("captionBox"))
        caption_border_width = int(sanitize_number(message.get("captionBorderWidth"), 0, 8, 2))
        caption_fade_in = float(sanitize_number(message.get("captionFadeInSec"), 0.0, 2.0, 0.0))
        caption_fade_out = float(sanitize_number(message.get("captionFadeOutSec"), 0.0, 2.0, 0.0))
        graphic_position = _sanitize_choice(
            message.get("graphicPosition"),
            {"center", "top", "bottom", "top_right", "top_left", "bottom_right", "bottom_left"},
            "center",
        )
        graphic_motion = normalize_graphic_motion(str(message.get("graphicMotion") or ""), "none")
        graphic_anim_in = float(sanitize_number(message.get("graphicAnimInSec"), 0.0, 3.0, 0.25))
        sfx_cap_n = int(sanitize_number(message.get("sfxCaptionEveryN"), 0, 20, 1))
        sfx_gfx_n = int(sanitize_number(message.get("sfxGraphicEveryN"), 0, 20, 1))
        graphic_fade_in = float(sanitize_number(message.get("graphicFadeInSec"), 0.0, 5.0, 0.0))
        graphic_fade_out = float(sanitize_number(message.get("graphicFadeOutSec"), 0.0, 5.0, 0.0))
        face_zoom_on = bool(message.get("faceZoomEnabled"))
        face_zoom_iv = float(sanitize_number(message.get("faceZoomIntervalSec"), 0.5, 30.0, 3.0))
        face_zoom_pulse = float(sanitize_number(message.get("faceZoomPulseSec"), 0.05, 2.0, 0.35))
        face_zoom_str = float(sanitize_number(message.get("faceZoomStrength"), 0.0, 0.45, 0.12))
        aspect_raw = str(message.get("outputAspectRatio") or "original").strip().lower()
        output_aspect = aspect_raw if aspect_raw in ("original", "16:9", "9:16", "1:1", "4:5") else "original"
        video_speed = float(sanitize_number(message.get("videoSpeed"), 0.25, 4.0, 1.0))

        silence_result = detect_silence(video_path, silence_threshold_db=silence_db, min_silence_duration_ms=silence_ms)
        total_duration = silence_result.data.get("total_duration", 0) if silence_result.ok and silence_result.data else 0
        silences = silence_result.data.get("silences", []) if silence_result.ok and silence_result.data else []

        keep_segments = _invert_silences(silences, total_duration)
        keep_segments = _pad_segments(keep_segments, padding_ms / 1000.0, total_duration)
        keep_segments = _merge_close_segments(keep_segments, merge_gap_ms / 1000.0)
        keep_segments = _drop_tiny_segments(keep_segments, min_keep_ms / 1000.0)

        if not keep_segments:
            keep_segments = [{"start": 0.0, "end": total_duration}]

        segs = segments if isinstance(segments, list) else []
        mats = matches if isinstance(matches, list) else []
        ev_result = build_events(
            segs,
            mats,
            silences,
            float(total_duration),
            attention_length_ms=attention_ms,
        )
        events = ev_result.data.get("events", []) if ev_result.ok and ev_result.data else []

        def _emit_export_progress(percent: int) -> None:
            sys.stdout.write(
                json.dumps({"_exportProgress": {"percent": int(percent)}}) + "\n"
            )
            sys.stdout.flush()

        result = render_full(
            video_path=video_path,
            output_path=output_path,
            segments=segs,
            matches=mats,
            sfx_pool=sfx_pool if isinstance(sfx_pool, dict) else {},
            keep_segments=keep_segments,
            events=events,
            max_words=max_words,
            graphic_width_frac=graphic_width_frac,
            caption_font_size=caption_font_size,
            caption_font_color_hex=caption_font_color,
            caption_outline_color_hex=caption_outline_color,
            caption_position=caption_position,
            caption_bold=caption_bold,
            caption_box=caption_box,
            caption_border_width=caption_border_width,
            caption_fade_in_sec=caption_fade_in,
            caption_fade_out_sec=caption_fade_out,
            graphic_position=graphic_position,
            graphic_motion=graphic_motion,
            graphic_anim_in_sec=graphic_anim_in,
            sfx_assignments=sfx_assignments,
            sfx_caption_every_n=sfx_cap_n,
            sfx_graphic_every_n=sfx_gfx_n,
            graphic_fade_in_sec=graphic_fade_in,
            graphic_fade_out_sec=graphic_fade_out,
            face_zoom_enabled=face_zoom_on,
            face_zoom_interval_sec=face_zoom_iv,
            face_zoom_pulse_sec=face_zoom_pulse,
            face_zoom_strength=face_zoom_str,
            output_aspect_ratio=output_aspect,
            video_speed=video_speed,
            progress_callback=_emit_export_progress,
        )
        if result.ok and result.data is not None:
            new_dur = sum(float(s["end"]) - float(s["start"]) for s in keep_segments)
            result.data["original_duration"] = float(total_duration)
            result.data["new_duration"] = round(new_dur, 3)
            result.data["silences_removed"] = len(silences)
        return result

    if command == "encodePreview":
        video_path = message.get("videoPath", "")
        err = validate_video_path(video_path)
        if err:
            return err
        output_path = message.get("outputPath", "")
        out_err = validate_output_path(output_path)
        if out_err:
            return out_err

        segments = message.get("segments", [])
        matches = message.get("matches", [])
        sfx_pool = message.get("sfxPool", {})
        sfx_assignments = _parse_sfx_assignments_message(message.get("sfxAssignments"))
        max_words = int(sanitize_number(message.get("maxWords"), 1, 20, 3))
        silence_db = int(sanitize_number(message.get("silenceThresholdDb"), -60, 0, -40))
        silence_ms = int(sanitize_number(message.get("minSilenceDurationMs"), 100, 5000, 800))
        padding_ms = int(sanitize_number(message.get("paddingMs"), 0, 1000, 200))
        merge_gap_ms = int(sanitize_number(message.get("mergeGapMs"), 0, 2000, 300))
        min_keep_ms = int(sanitize_number(message.get("minKeepMs"), 0, 1000, 150))
        attention_ms = int(sanitize_number(message.get("attentionLengthMs"), 500, 60000, 3000))
        graphic_w_pct = float(sanitize_number(message.get("graphicWidthPercent"), 10.0, 100.0, 85.0))
        graphic_width_frac = graphic_w_pct / 100.0
        caption_font_size = int(sanitize_number(message.get("captionFontSize"), 12, 120, 24))
        caption_font_color = _sanitize_hex_color(message.get("captionFontColor"), "FFFFFF")
        caption_outline_color = _sanitize_hex_color(
            message.get("captionOutlineColor"), "000000"
        )
        caption_position = _sanitize_choice(
            message.get("captionPosition"), {"bottom", "center"}, "bottom"
        )
        caption_bold = bool(message.get("captionBold"))
        caption_box = bool(message.get("captionBox"))
        caption_border_width = int(sanitize_number(message.get("captionBorderWidth"), 0, 8, 2))
        caption_fade_in = float(sanitize_number(message.get("captionFadeInSec"), 0.0, 2.0, 0.0))
        caption_fade_out = float(sanitize_number(message.get("captionFadeOutSec"), 0.0, 2.0, 0.0))
        graphic_position = _sanitize_choice(
            message.get("graphicPosition"),
            {"center", "top", "bottom", "top_right", "top_left", "bottom_right", "bottom_left"},
            "center",
        )
        graphic_motion = normalize_graphic_motion(str(message.get("graphicMotion") or ""), "none")
        graphic_anim_in = float(sanitize_number(message.get("graphicAnimInSec"), 0.0, 3.0, 0.25))
        sfx_cap_n = int(sanitize_number(message.get("sfxCaptionEveryN"), 0, 20, 1))
        sfx_gfx_n = int(sanitize_number(message.get("sfxGraphicEveryN"), 0, 20, 1))
        graphic_fade_in = float(sanitize_number(message.get("graphicFadeInSec"), 0.0, 5.0, 0.0))
        graphic_fade_out = float(sanitize_number(message.get("graphicFadeOutSec"), 0.0, 5.0, 0.0))
        face_zoom_on = bool(message.get("faceZoomEnabled"))
        face_zoom_iv = float(sanitize_number(message.get("faceZoomIntervalSec"), 0.5, 30.0, 3.0))
        face_zoom_pulse = float(sanitize_number(message.get("faceZoomPulseSec"), 0.05, 2.0, 0.35))
        face_zoom_str = float(sanitize_number(message.get("faceZoomStrength"), 0.0, 0.45, 0.12))
        aspect_raw = str(message.get("outputAspectRatio") or "original").strip().lower()
        output_aspect = aspect_raw if aspect_raw in ("original", "16:9", "9:16", "1:1", "4:5") else "original"
        video_speed = float(sanitize_number(message.get("videoSpeed"), 0.25, 4.0, 1.0))
        preview_w = int(sanitize_number(message.get("previewMaxWidth"), 240, 960, 480))
        preview_crf = int(sanitize_number(message.get("previewCrf"), 18, 35, 28))
        preview_fps = int(sanitize_number(message.get("previewMaxFps"), 6, 30, 12))

        keep_from = message.get("keepSegments")
        events_from = message.get("events")
        use_client = isinstance(keep_from, list) and len(keep_from) > 0 and isinstance(events_from, list)

        if use_client:
            keep_segments: list[dict[str, float]] = []
            for item in keep_from:
                if not isinstance(item, dict):
                    continue
                try:
                    ks = float(item.get("start", 0.0))
                    ke = float(item.get("end", 0.0))
                except (TypeError, ValueError):
                    continue
                if ke > ks:
                    keep_segments.append({"start": ks, "end": ke})
            if not keep_segments:
                return EngineResult(ok=False, error="encodePreview: invalid keepSegments")
            events = list(events_from)
            segs = segments if isinstance(segments, list) else []
            mats = matches if isinstance(matches, list) else []
        else:
            silence_result = detect_silence(
                video_path, silence_threshold_db=silence_db, min_silence_duration_ms=silence_ms
            )
            total_duration = (
                silence_result.data.get("total_duration", 0) if silence_result.ok and silence_result.data else 0
            )
            silences = silence_result.data.get("silences", []) if silence_result.ok and silence_result.data else []

            keep_segments = _invert_silences(silences, total_duration)
            keep_segments = _pad_segments(keep_segments, padding_ms / 1000.0, total_duration)
            keep_segments = _merge_close_segments(keep_segments, merge_gap_ms / 1000.0)
            keep_segments = _drop_tiny_segments(keep_segments, min_keep_ms / 1000.0)

            if not keep_segments:
                keep_segments = [{"start": 0.0, "end": total_duration}]

            segs = segments if isinstance(segments, list) else []
            mats = matches if isinstance(matches, list) else []
            ev_result = build_events(
                segs,
                mats,
                silences,
                float(total_duration),
                attention_length_ms=attention_ms,
            )
            events = ev_result.data.get("events", []) if ev_result.ok and ev_result.data else []

        def _emit_preview_progress(percent: int) -> None:
            sys.stdout.write(json.dumps({"_previewProgress": {"percent": int(percent)}}) + "\n")
            sys.stdout.flush()

        result = render_full(
            video_path=video_path,
            output_path=output_path,
            segments=segs,
            matches=mats,
            sfx_pool=sfx_pool if isinstance(sfx_pool, dict) else {},
            keep_segments=keep_segments,
            events=events,
            max_words=max_words,
            graphic_width_frac=graphic_width_frac,
            caption_font_size=caption_font_size,
            caption_font_color_hex=caption_font_color,
            caption_outline_color_hex=caption_outline_color,
            caption_position=caption_position,
            caption_bold=caption_bold,
            caption_box=caption_box,
            caption_border_width=caption_border_width,
            caption_fade_in_sec=caption_fade_in,
            caption_fade_out_sec=caption_fade_out,
            graphic_position=graphic_position,
            graphic_motion=graphic_motion,
            graphic_anim_in_sec=graphic_anim_in,
            sfx_assignments=sfx_assignments,
            sfx_caption_every_n=sfx_cap_n,
            sfx_graphic_every_n=sfx_gfx_n,
            graphic_fade_in_sec=graphic_fade_in,
            graphic_fade_out_sec=graphic_fade_out,
            face_zoom_enabled=face_zoom_on,
            face_zoom_interval_sec=face_zoom_iv,
            face_zoom_pulse_sec=face_zoom_pulse,
            face_zoom_strength=face_zoom_str,
            output_aspect_ratio=output_aspect,
            video_speed=video_speed,
            progress_callback=_emit_preview_progress,
            preview_max_width=preview_w,
            preview_crf=preview_crf,
            preview_max_fps=preview_fps,
        )
        if not result.ok:
            return result
        if result.data is not None:
            result.data["preview_path"] = output_path
        return result

    return EngineResult(ok=False, error=f"Unknown command: {command}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            result = EngineResult(ok=False, error=f"Invalid JSON: {exc}")
            sys.stdout.write(json.dumps(result.to_dict()) + "\n")
            sys.stdout.flush()
            continue

        result = handle(message)
        sys.stdout.write(json.dumps(result.to_dict()) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
