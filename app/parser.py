from __future__ import annotations

from .models import ParseResult, SceneSpec, VideoListSpec


class PromptFormatError(ValueError):
    pass


def _split_unescaped_pipes(line: str) -> list[str]:
    r"""Split on | while allowing \| inside prompt text."""
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for char in line:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "|":
            fields.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if escaped:
        current.append("\\")
    fields.append("".join(current).strip())
    return fields


def parse_prompt_lists(text: str) -> ParseResult:
    groups: list[list[SceneSpec]] = [[]]
    warnings: list[str] = []

    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line == "___":
            if not groups[-1]:
                warnings.append(f"Line {line_number}: empty list separator ignored")
            else:
                groups.append([])
            continue

        fields = _split_unescaped_pipes(line)
        if len(fields) != 3:
            raise PromptFormatError(
                f"Line {line_number}: expected exactly 3 fields: "
                "image prompt | video prompt | duration"
            )
        image_prompt, video_prompt, duration_text = fields
        if not video_prompt:
            raise PromptFormatError(f"Line {line_number}: video prompt is required")
        try:
            duration = float(duration_text.replace(",", "."))
        except ValueError as exc:
            raise PromptFormatError(
                f"Line {line_number}: invalid duration {duration_text!r}"
            ) from exc
        if duration <= 0 or duration > 600:
            raise PromptFormatError(
                f"Line {line_number}: duration must be greater than 0 and at most 600 seconds"
            )
        groups[-1].append(
            SceneSpec(
                image_prompt=image_prompt,
                video_prompt=video_prompt,
                duration=duration,
                line_number=line_number,
            )
        )

    groups = [group for group in groups if group]
    if not groups:
        raise PromptFormatError("No valid prompt lines found")

    return ParseResult(
        lists=[
            VideoListSpec(list_index=index + 1, scenes=scenes)
            for index, scenes in enumerate(groups)
        ],
        warnings=warnings,
    )


SUPPORTED_DURATIONS = (4, 6, 8, 10)


def nearest_supported_duration(seconds: float) -> int:
    for value in SUPPORTED_DURATIONS:
        if seconds <= value:
            return value
    return SUPPORTED_DURATIONS[-1]


def duration_chunks(seconds: float) -> list[int]:
    if seconds <= 10:
        return [nearest_supported_duration(seconds)]
    chunks: list[int] = []
    remaining = seconds
    while remaining > 10:
        chunks.append(10)
        remaining -= 10
    if remaining > 0.001:
        chunks.append(nearest_supported_duration(remaining))
    return chunks


def exact_trim_chunks(seconds: float, generated_chunks: list[int]) -> list[float]:
    trims: list[float] = []
    remaining = seconds
    for generated in generated_chunks:
        if remaining <= 0:
            break
        trim = min(float(generated), remaining)
        trims.append(trim)
        remaining -= trim
    if remaining > 0.01:
        raise ValueError("Generated chunks do not cover requested duration")
    return trims
