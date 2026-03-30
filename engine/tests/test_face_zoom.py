"""Face-zoom window scheduling on the output timeline."""

from engine.face_zoom import compute_zoom_windows_output, _merge_intervals


def test_merge_intervals() -> None:
    assert _merge_intervals([(0, 1), (1, 2)]) == [(0, 2)]
    assert _merge_intervals([(0, 1), (1.5, 2)]) == [(0, 1), (1.5, 2)]


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
