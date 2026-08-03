from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from .config import settings


class FfmpegError(RuntimeError):
    pass


@dataclass(frozen=True)
class ClipPlan:
    path: Path
    trim_seconds: float


@dataclass(frozen=True)
class ComposeOptions:
    aspect: str = "16:9"
    music_path: Path | None = None
    voice_path: Path | None = None
    music_volume: float = 0.18
    voice_volume: float = 1.0
    source_audio_volume: float = 1.0
    normalize_audio: bool = True


def target_dimensions(aspect: str) -> tuple[int, int]:
    return {
        "16:9": (1920, 1080),
        "9:16": (1080, 1920),
        "1:1": (1080, 1080),
    }.get(aspect, (1920, 1080))


async def _run(*args: str, timeout: float = 1800) -> tuple[str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise FfmpegError(f"Command timed out: {' '.join(args[:4])}")
    out = stdout.decode("utf-8", errors="replace")
    err = stderr.decode("utf-8", errors="replace")
    if process.returncode != 0:
        raise FfmpegError(err[-6000:] or f"Command failed with exit {process.returncode}")
    return out, err


async def ffprobe(path: Path) -> dict:
    stdout, _ = await _run(
        settings.ffprobe_bin,
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
        timeout=60,
    )
    return json.loads(stdout)


async def media_duration(path: Path) -> float:
    data = await ffprobe(path)
    try:
        return float(data.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        return 0.0


async def has_audio(path: Path) -> bool:
    data = await ffprobe(path)
    return any(stream.get("codec_type") == "audio" for stream in data.get("streams", []))


async def extract_last_frame(video_path: Path, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    await _run(
        settings.ffmpeg_bin,
        "-y",
        "-sseof",
        "-0.12",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(output_path),
        timeout=120,
    )
    return output_path


async def create_mock_image(output_path: Path, label_seed: int = 0) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    await _run(
        settings.ffmpeg_bin,
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=1:duration=1",
        "-frames:v",
        "1",
        str(output_path),
        timeout=60,
    )
    return output_path


async def create_mock_video(output_path: Path, duration: int, aspect: str = "16:9") -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    width, height = target_dimensions(aspect)
    await _run(
        settings.ffmpeg_bin,
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={width}x{height}:rate=30:duration={duration}",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency=440:sample_rate=48000:duration={duration}",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "25",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(output_path),
        timeout=max(120, duration * 6),
    )
    return output_path


async def normalize_clip(plan: ClipPlan, output_path: Path, aspect: str) -> Path:
    width, height = target_dimensions(aspect)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    audio_present = await has_audio(plan.path)
    args = [settings.ffmpeg_bin, "-y", "-i", str(plan.path)]
    if not audio_present:
        args += [
            "-f",
            "lavfi",
            "-t",
            f"{plan.trim_seconds:.3f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
        ]
    args += [
        "-t",
        f"{plan.trim_seconds:.3f}",
        "-vf",
        (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
            "fps=30,setsar=1,format=yuv420p"
        ),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0" if audio_present else "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    await _run(*args, timeout=max(300, plan.trim_seconds * 12))
    return output_path


async def concat_normalized(clips: list[Path], output_path: Path) -> Path:
    if not clips:
        raise ValueError("No clips to concatenate")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    list_file = output_path.with_suffix(".concat.txt")
    lines = []
    for clip in clips:
        escaped = str(clip.resolve()).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        await _run(
            settings.ffmpeg_bin,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
            timeout=1800,
        )
    finally:
        list_file.unlink(missing_ok=True)
    return output_path


async def mix_audio(base_video: Path, output_path: Path, options: ComposeOptions) -> Path:
    if not options.music_path and not options.voice_path and options.source_audio_volume == 1.0:
        if base_video.resolve() != output_path.resolve():
            shutil.copy2(base_video, output_path)
        return output_path

    duration = await media_duration(base_video)
    args: list[str] = [settings.ffmpeg_bin, "-y", "-i", str(base_video)]
    audio_labels: list[str] = []
    filters: list[str] = []
    base_has_audio = await has_audio(base_video)

    if base_has_audio and options.source_audio_volume > 0:
        filters.append(f"[0:a]volume={options.source_audio_volume:.4f}[a0]")
        audio_labels.append("[a0]")

    next_index = 1
    if options.music_path:
        args += ["-stream_loop", "-1", "-i", str(options.music_path)]
        filters.append(
            f"[{next_index}:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,"
            f"volume={options.music_volume:.4f}[music]"
        )
        audio_labels.append("[music]")
        next_index += 1

    if options.voice_path:
        args += ["-i", str(options.voice_path)]
        filters.append(
            f"[{next_index}:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,"
            f"volume={options.voice_volume:.4f}[voice]"
        )
        audio_labels.append("[voice]")

    if not audio_labels:
        shutil.copy2(base_video, output_path)
        return output_path

    if len(audio_labels) == 1:
        filters.append(f"{audio_labels[0]}anull[mix]")
    else:
        filters.append(
            f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:"
            "duration=longest:dropout_transition=2[mix0]"
        )
        if options.normalize_audio:
            filters.append("[mix0]loudnorm=I=-16:TP=-1.5:LRA=11[mix]")
        else:
            filters.append("[mix0]anull[mix]")

    args += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "0:v:0",
        "-map",
        "[mix]",
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    await _run(*args, timeout=1800)
    return output_path


async def compose_video(
    plans: list[ClipPlan],
    output_path: Path,
    work_dir: Path,
    options: ComposeOptions,
) -> Path:
    if not plans:
        raise ValueError("No clip plans supplied")
    normalized_dir = work_dir / "normalized"
    normalized_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    for index, plan in enumerate(plans, start=1):
        out = normalized_dir / f"clip_{index:04d}.mp4"
        normalized.append(await normalize_clip(plan, out, options.aspect))

    base = work_dir / "base_concat.mp4"
    await concat_normalized(normalized, base)
    await mix_audio(base, output_path, options)
    return output_path
