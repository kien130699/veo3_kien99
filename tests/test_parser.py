import pytest

from app.parser import PromptFormatError, duration_chunks, exact_trim_chunks, parse_prompt_lists


def test_parse_multiple_lists_and_escaped_pipe():
    result = parse_prompt_lists(
        "image A | move left \\| then right | 8\n"
        " | text only video | 3.5\n"
        "___\n"
        "image B | orbit | 12\n"
    )
    assert len(result.lists) == 2
    assert result.scene_count == 3
    assert result.lists[0].scenes[0].video_prompt == "move left | then right"
    assert result.total_duration == pytest.approx(23.5)


def test_bad_field_count_is_rejected():
    with pytest.raises(PromptFormatError, match="exactly 3 fields"):
        parse_prompt_lists("one | two")


def test_empty_video_prompt_is_rejected():
    with pytest.raises(PromptFormatError, match="video prompt"):
        parse_prompt_lists("image | | 8")


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [(1, [4]), (4, [4]), (4.1, [6]), (7, [8]), (10, [10]), (12, [10, 4]), (26, [10, 10, 6])],
)
def test_duration_chunks(seconds, expected):
    assert duration_chunks(seconds) == expected


def test_exact_trim_chunks():
    assert exact_trim_chunks(12, [10, 4]) == [10.0, 2.0]
    assert exact_trim_chunks(3.5, [4]) == [3.5]
