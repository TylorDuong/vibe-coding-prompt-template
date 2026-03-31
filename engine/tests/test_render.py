"""Tests for the full video renderer (caption chunking and render_full)."""

import os
import subprocess
import tempfile

import pytest

from engine.render import (
    chunk_words,
    build_caption_chunks,
    collect_sfx_plays,
    normalize_graphic_motion,
    render_full,
    source_time_to_output,
    remap_interval,
    wrap_caption_line_to_width,
    wrap_caption_chunks_for_frame,
    _append_caption_drawtext_clauses,
    _caption_y_expr,
    _overlay_dims_uniform,
    _center_crop_filter,
    _atempo_segments,
    _chain_audio_atempo,
    _stderr_time_sec,
    _ffmpeg_stderr_marks_mux_done,
)


def test_chunk_words_basic() -> None:
    words = [
        {"word": " Today", "start": 0.0, "end": 0.3},
        {"word": " we", "start": 0.3, "end": 0.5},
        {"word": " are", "start": 0.5, "end": 0.7},
        {"word": " going", "start": 0.7, "end": 1.0},
        {"word": " to", "start": 1.0, "end": 1.2},
    ]
    chunks = chunk_words(words, max_words=3)
    assert len(chunks) == 2
    assert "Today" in chunks[0]["text"]
    assert chunks[0]["start"] == 0.0
    assert chunks[0]["end"] == 0.7
    assert "going" in chunks[1]["text"]


def test_chunk_words_single_word() -> None:
    words = [{"word": "Hello", "start": 0.0, "end": 0.5}]
    chunks = chunk_words(words, max_words=3)
    assert len(chunks) == 1
    assert chunks[0]["text"] == "Hello"


def test_chunk_words_empty() -> None:
    assert chunk_words([], max_words=3) == []


def test_build_caption_chunks_from_segments() -> None:
    segments = [
        {
            "start": 0.0, "end": 2.0, "text": "Hello world",
            "words": [
                {"word": " Hello", "start": 0.0, "end": 0.5},
                {"word": " world", "start": 0.5, "end": 1.0},
            ],
        },
    ]
    chunks = build_caption_chunks(segments, max_words=1)
    assert len(chunks) == 2
    assert chunks[0]["text"] == "Hello"
    assert chunks[1]["text"] == "world"


def test_build_caption_chunks_fallback_no_words() -> None:
    segments = [{"start": 0.0, "end": 2.0, "text": "Fallback text"}]
    chunks = build_caption_chunks(segments, max_words=3)
    assert len(chunks) == 1
    assert chunks[0]["text"] == "Fallback text"


def test_source_time_to_output_no_cuts() -> None:
    keep = [{"start": 0.0, "end": 10.0}]
    assert source_time_to_output(2.5, keep) == 2.5


def test_source_time_to_output_skips_gap() -> None:
    keep = [{"start": 0.0, "end": 2.0}, {"start": 5.0, "end": 8.0}]
    assert source_time_to_output(1.0, keep) == 1.0
    assert source_time_to_output(5.0, keep) == 2.0
    assert source_time_to_output(6.0, keep) == 3.0


def test_remap_interval_collapses_in_gap() -> None:
    keep = [{"start": 0.0, "end": 2.0}, {"start": 5.0, "end": 8.0}]
    assert remap_interval(2.5, 4.5, keep) is None


def test_collect_sfx_caption_every_n(tmp_path) -> None:
    wav = tmp_path / "x.wav"
    wav.write_bytes(b"fake")
    events = [
        {"type": "sfx", "start": 0.0, "trigger": "caption_entry"},
        {"type": "sfx", "start": 0.5, "trigger": "caption_entry"},
        {"type": "sfx", "start": 1.0, "trigger": "caption_entry"},
        {"type": "sfx", "start": 1.5, "trigger": "caption_entry"},
    ]
    assigns = [{"trigger": "caption_entry", "filePath": str(wav), "volume": 1.0}]
    keep = [{"start": 0.0, "end": 10.0}]
    plays = collect_sfx_plays(events, {}, assigns, keep, caption_every_n=2, graphic_every_n=1)
    assert len(plays) == 2


def test_collect_sfx_caption_every_n_zero_skips(tmp_path) -> None:
    wav = tmp_path / "x.wav"
    wav.write_bytes(b"fake")
    events = [
        {"type": "sfx", "start": 0.0, "trigger": "caption_entry"},
        {"type": "sfx", "start": 0.5, "trigger": "graphic_entry"},
    ]
    assigns = [
        {"trigger": "caption_entry", "filePath": str(wav), "volume": 1.0},
        {"trigger": "graphic_entry", "filePath": str(wav), "volume": 1.0},
    ]
    keep = [{"start": 0.0, "end": 10.0}]
    assert len(collect_sfx_plays(events, {}, assigns, keep, caption_every_n=0, graphic_every_n=1)) == 1
    assert len(collect_sfx_plays(events, {}, assigns, keep, caption_every_n=1, graphic_every_n=0)) == 1


@pytest.fixture(scope="module")
def test_video_with_audio() -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-f", "lavfi", "-i", "color=c=black:s=320x240:d=3:r=25",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac",
            "-shortest",
            tmp.name,
        ],
        capture_output=True,
        check=True,
    )
    yield tmp.name
    os.unlink(tmp.name)


def test_render_full_captions_only(test_video_with_audio: str) -> None:
    """Render with captions only (no graphics, no SFX)."""
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()

    segments = [
        {
            "start": 0.0, "end": 1.5, "text": "Test caption",
            "words": [
                {"word": " Test", "start": 0.0, "end": 0.5},
                {"word": " caption", "start": 0.5, "end": 1.0},
            ],
        },
    ]

    try:
        result = render_full(
            video_path=test_video_with_audio,
            output_path=out.name,
            segments=segments,
            matches=[],
            sfx_pool={},
            keep_segments=[{"start": 0.0, "end": 3.0}],
            events=[],
            max_words=3,
        )
        assert result.ok is True, result.error
        assert result.data is not None
        assert result.data["captions_rendered"] == 1
        assert os.path.isfile(out.name)
        assert os.path.getsize(out.name) > 0
    finally:
        if os.path.exists(out.name):
            os.unlink(out.name)


def test_overlay_dims_square_on_vertical_frame() -> None:
    """9:16 frame, square image: output must stay square at ~95% frame width."""
    ow, oh = _overlay_dims_uniform(1080, 1920, 1000, 1000, 0.95)
    assert ow == oh
    assert ow == 1026


def test_overlay_dims_tall_on_vertical_frame() -> None:
    """Very tall image: height hits frame_h first, width shrinks."""
    ow, oh = _overlay_dims_uniform(1080, 1920, 400, 2000, 0.95)
    assert oh == 1920
    assert ow == 384


def test_render_full_face_zoom_uses_zoompan(test_video_with_audio: str, monkeypatch) -> None:
    from engine import render as render_mod

    captured: list[str] = []
    real_write = render_mod._write_temp_filter_complex_script

    def wrap(graph: str) -> str:
        captured.append(graph)
        return real_write(graph)

    monkeypatch.setattr(render_mod, "_write_temp_filter_complex_script", wrap)

    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()
    segments = [
        {
            "start": 0.0,
            "end": 1.0,
            "text": "Hi",
            "words": [{"word": " Hi", "start": 0.0, "end": 0.5}],
        },
    ]
    try:
        result = render_mod.render_full(
            video_path=test_video_with_audio,
            output_path=out.name,
            segments=segments,
            matches=[],
            sfx_pool={},
            keep_segments=[{"start": 0.0, "end": 3.0}],
            events=[],
            face_zoom_enabled=True,
            face_zoom_interval_sec=2.0,
            face_zoom_pulse_sec=0.3,
            face_zoom_strength=0.15,
        )
        assert result.ok is True, result.error
        joined = "\n".join(captured)
        assert "zoompan" in joined
    finally:
        if os.path.exists(out.name):
            os.unlink(out.name)


def test_center_crop_filter_original_none() -> None:
    assert _center_crop_filter(1920, 1080, "original") is None
    assert _center_crop_filter(1920, 1080, "") is None


def test_center_crop_filter_produces_even_dims() -> None:
    c = _center_crop_filter(320, 240, "9:16")
    assert c is not None
    assert c.startswith("crop=")
    parts = c.split("=")[1].split(":")
    assert len(parts) == 4
    w, h, x, y = (int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3]))
    assert w % 2 == 0 and h % 2 == 0
    assert w > 0 and h > 0


def test_atempo_segments_identity_and_double() -> None:
    assert _atempo_segments(1.0) == []
    assert _atempo_segments(2.0) == ["atempo=2.000000"]
    s4 = _atempo_segments(4.0)
    assert len(s4) == 2
    assert s4[0] == "atempo=2.0"
    assert s4[1] == "atempo=2.000000"


def test_chain_audio_atempo_empty_at_speed_one() -> None:
    assert _chain_audio_atempo("a0", 1.0, "afc") == ""


def test_render_full_respects_outline_crop_speed_in_filter_graph(
    test_video_with_audio: str, monkeypatch,
) -> None:
    from engine import render as render_mod

    captured: list[str] = []
    real_write = render_mod._write_temp_filter_complex_script

    def wrap(graph: str) -> str:
        captured.append(graph)
        return real_write(graph)

    monkeypatch.setattr(render_mod, "_write_temp_filter_complex_script", wrap)

    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()
    segments = [
        {
            "start": 0.0,
            "end": 1.0,
            "text": "Hi",
            "words": [{"word": " Hi", "start": 0.0, "end": 0.5}],
        },
    ]
    try:
        result = render_mod.render_full(
            video_path=test_video_with_audio,
            output_path=out.name,
            segments=segments,
            matches=[],
            sfx_pool={},
            keep_segments=[{"start": 0.0, "end": 3.0}],
            events=[],
            caption_outline_color_hex="FF0000",
            output_aspect_ratio="16:9",
            video_speed=2.0,
        )
        assert result.ok is True, result.error
        joined = "\n".join(captured)
        assert "bordercolor=0xFF0000" in joined
        assert "crop=" in joined
        assert "setpts=PTS/2" in joined
        assert "atempo=" in joined
    finally:
        if os.path.exists(out.name):
            os.unlink(out.name)


def test_render_full_graphic_fade_in_filter(test_video_with_audio: str, tmp_path, monkeypatch) -> None:
    pytest.importorskip("PIL")
    from PIL import Image
    from engine import render as render_mod

    png = tmp_path / "overlay.png"
    Image.new("RGBA", (80, 80), (200, 50, 50, 255)).save(png)

    captured: list[str] = []
    real_write = render_mod._write_temp_filter_complex_script

    def wrap(graph: str) -> str:
        captured.append(graph)
        return real_write(graph)

    monkeypatch.setattr(render_mod, "_write_temp_filter_complex_script", wrap)

    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()
    segments = [
        {
            "start": 0.0,
            "end": 2.0,
            "text": "Show graphic",
            "words": [{"word": " Show", "start": 0.0, "end": 0.4}],
        },
    ]
    matches = [
        {
            "graphic": str(png),
            "similarity": 1.0,
            "matched_segment_start": 0.2,
            "matched_segment_end": 1.5,
        },
    ]
    try:
        result = render_mod.render_full(
            video_path=test_video_with_audio,
            output_path=out.name,
            segments=segments,
            matches=matches,
            sfx_pool={},
            keep_segments=[{"start": 0.0, "end": 3.0}],
            events=[],
            graphic_fade_in_sec=0.2,
            graphic_fade_out_sec=0.2,
        )
        assert result.ok is True, result.error
        joined = "\n".join(captured)
        assert "fade=t=in" in joined
        assert "format=rgba" in joined
    finally:
        if os.path.exists(out.name):
            os.unlink(out.name)


def test_stderr_time_sec_out_time_ms() -> None:
    assert abs((_stderr_time_sec("frame=1 out_time_ms=5000") or 0) - 5.0) < 0.001


def test_stderr_time_sec_integer_microseconds() -> None:
    assert abs((_stderr_time_sec("progress out_time=2500000 dup=0 drop=0") or 0) - 2.5) < 0.001


def test_stderr_time_sec_prefers_hhmmss_time_field() -> None:
    t = _stderr_time_sec("frame=1 time=00:00:07.50 speed=1.2x")
    assert t is not None and abs(t - 7.5) < 0.01


def test_ffmpeg_stderr_mux_done_lsize_case_insensitive() -> None:
    assert _ffmpeg_stderr_marks_mux_done("lsize=   12345KiB time=00:00:01.00 bitrate=1")
    assert _ffmpeg_stderr_marks_mux_done("Lsize=   12345KiB time=00:00:01.00 bitrate=1")
    assert _ffmpeg_stderr_marks_mux_done("video:123kB audio:45kB subtitle:0kB muxing overhead: 0.1%")


def test_wrap_caption_line_fallback_adds_newlines() -> None:
    long = "word " * 50
    out = wrap_caption_line_to_width(long, max_width_px=80, font_size=24, bold=False)
    assert "\n" in out


def test_normalize_graphic_motion_slide_right_alias() -> None:
    assert normalize_graphic_motion("slide_right", "none") == "slide_in"
    assert normalize_graphic_motion("slide_up", "none") == "slide_up"
    assert normalize_graphic_motion("bogus", "slide_left") == "slide_left"


def test_caption_y_expr_bottom_uses_text_h_not_th() -> None:
    y = _caption_y_expr("bottom", 48, border_w=2)
    assert "h-text_h-" in y
    assert "h-th-" not in y


def test_wrap_caption_chunks_matches_shrunk_draw_width() -> None:
    long = "word " * 80
    margin = 48
    inner = 1000 - 2 * margin
    w_shrunk = max(80, int(inner * 0.88))
    expected = wrap_caption_line_to_width(long, w_shrunk, 24, False)
    out = wrap_caption_chunks_for_frame(
        [{"start": 0.0, "end": 1.0, "text": long}],
        frame_width=1000,
        cap_margin=margin,
        caption_font_size=24,
        caption_bold=False,
    )
    assert out[0]["text"] == expected


def test_append_multiline_caption_emits_one_drawtext_per_line() -> None:
    clauses: list[str] = []
    _append_caption_drawtext_clauses(
        clauses,
        {"start": 0.0, "end": 1.0, "text": "line one\nline two"},
        font_prefix="",
        caption_font_size=24,
        font_color="white",
        border_color="black",
        caption_border_width=2,
        line_spacing=6,
        caption_position="bottom",
        cap_margin=48,
        caption_box=False,
        caption_fade_in_sec=0.0,
        caption_fade_out_sec=0.0,
    )
    assert len(clauses) == 2
    assert "line one" in clauses[0] and "line two" in clauses[1]
    assert "line_spacing=" not in clauses[0]


def test_append_caption_skips_blank_only_lines() -> None:
    clauses: list[str] = []
    _append_caption_drawtext_clauses(
        clauses,
        {"start": 0.0, "end": 1.0, "text": "only\n\n"},
        font_prefix="",
        caption_font_size=24,
        font_color="white",
        border_color="black",
        caption_border_width=2,
        line_spacing=6,
        caption_position="bottom",
        cap_margin=48,
        caption_box=False,
        caption_fade_in_sec=0.0,
        caption_fade_out_sec=0.0,
    )
    assert len(clauses) == 1
    assert "only" in clauses[0]


def test_append_caption_whitespace_only_emits_nothing() -> None:
    clauses: list[str] = []
    _append_caption_drawtext_clauses(
        clauses,
        {"start": 0.0, "end": 1.0, "text": "  \n  \t  "},
        font_prefix="",
        caption_font_size=24,
        font_color="white",
        border_color="black",
        caption_border_width=2,
        line_spacing=6,
        caption_position="bottom",
        cap_margin=48,
        caption_box=False,
        caption_fade_in_sec=0.0,
        caption_fade_out_sec=0.0,
    )
    assert len(clauses) == 0
