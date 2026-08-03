from pathlib import Path

import pytest

from app.compositor import ClipPlan, ComposeOptions, compose_video, create_mock_video, media_duration


@pytest.mark.asyncio
async def test_mock_clips_compose_to_exact_duration(tmp_path: Path):
    one = await create_mock_video(tmp_path / "one.mp4", 4, "16:9")
    two = await create_mock_video(tmp_path / "two.mp4", 6, "16:9")
    output = tmp_path / "final.mp4"
    await compose_video(
        [ClipPlan(one, 2.0), ClipPlan(two, 3.0)],
        output,
        tmp_path / "work",
        ComposeOptions(aspect="16:9"),
    )
    assert output.exists()
    assert output.stat().st_size > 1000
    duration = await media_duration(output)
    assert duration == pytest.approx(5.0, abs=0.25)
