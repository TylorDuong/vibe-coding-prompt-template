"""Face-zoom window scheduling on the output timeline."""

from engine.face_zoom import (
    build_zoom_active_expression,
    compute_zoom_windows_output,
    _merge_intervals,
)


def test_merge_intervals() -> None:
    assert _merge_intervals([(0, 1), (1, 2)]) == [(0, 2)]
    assert _merge_intervals([(0, 1), (1.5, 2)]) == [(0, 1), (1.5, 2)]


def test_zoom_windows_nonempty_without_graphics() -> None:
    wins = compute_zoom_windows_output(
        out_duration=10.0,
        interval_sec=3.0,
        pulse_sec=0.35,
        graphic_intervals=[],
    )
    assert len(wins) >= 1


def test_build_zoom_active_expression_in_time() -> None:
    expr = build_zoom_active_expression([(1.0, 2.0)], time_var="in_time")
    assert "in_time" in expr


def test_build_zoom_active_expression_default_uses_t() -> None:
    expr = build_zoom_active_expression([(1.0, 2.0)])
    assert "between(t\\," in expr


def test_zoom_windows_skip_graphic_overlap() -> None:
    graphic = [(1.0, 2.0)]
    wins = compute_zoom_windows_output(
        out_duration=10.0,
        interval_sec=3.0,
        pulse_sec=0.5,
        graphic_intervals=graphic,
    )
    assert wins
    for a, b in wins:
        assert b > a
        assert a >= 0
