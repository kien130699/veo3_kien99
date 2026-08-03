from __future__ import annotations

import asyncio
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .compositor import ClipPlan, ComposeOptions, compose_video, extract_last_frame
from .config import settings
from .edge_flow import EdgeFlowDriver, FlowBlockedError
from .models import AudioOptions, CreateJobRequest, JobProgress, JobRecord, JobState
from .parser import duration_chunks, exact_trim_chunks, parse_prompt_lists
from .storage import storage, utc_now


@dataclass
class RuntimeControl:
    pause_gate: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_requested: bool = False
    event_queue: asyncio.Queue[dict[str, Any]] = field(default_factory=asyncio.Queue)
    task: asyncio.Task | None = None

    def __post_init__(self) -> None:
        self.pause_gate.set()


class JobCancelled(Exception):
    pass


class JobManager:
    def __init__(self) -> None:
        self.controls: dict[str, RuntimeControl] = {}
        self._flow_lock = asyncio.Lock()
        self._record_lock = asyncio.Lock()

    def get(self, job_id: str) -> JobRecord:
        return storage.load_job(job_id)

    def list(self) -> list[JobRecord]:
        return storage.list_jobs()

    async def create(self, request: CreateJobRequest) -> JobRecord:
        parsed = parse_prompt_lists(request.input_text)
        job_id = uuid.uuid4().hex
        now = utc_now()
        generation_total = sum(
            1 + len(duration_chunks(scene.duration)) if scene.image_prompt else len(duration_chunks(scene.duration))
            for group in parsed.lists
            for scene in group.scenes
        )
        job = JobRecord(
            id=job_id,
            state=JobState.QUEUED,
            created_at=now,
            updated_at=now,
            request=request,
            parsed=parsed,
            progress=JobProgress(current=0, total=generation_total, percent=0, message="Queued"),
        )
        storage.save_job(job)
        control = RuntimeControl()
        self.controls[job_id] = control
        await self._emit(job_id, "info", "Job queued", {"generation_units": generation_total})
        control.task = asyncio.create_task(self._run(job_id), name=f"veo-job-{job_id[:8]}")
        return storage.load_job(job_id)

    async def _load_mutate(self, job_id: str, mutator) -> JobRecord:
        async with self._record_lock:
            job = storage.load_job(job_id)
            mutator(job)
            job.updated_at = utc_now()
            storage.save_job(job)
            return job

    async def _emit(
        self,
        job_id: str,
        level: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        event = {"time": utc_now(), "level": level, "message": message, "data": data or {}}

        def mutate(job: JobRecord) -> None:
            job.logs.append(event)
            if len(job.logs) > 1000:
                job.logs = job.logs[-1000:]

        try:
            await self._load_mutate(job_id, mutate)
        except FileNotFoundError:
            return
        control = self.controls.get(job_id)
        if control:
            await control.event_queue.put(event)

    async def _set_progress(self, job_id: str, current: int, message: str) -> None:
        def mutate(job: JobRecord) -> None:
            total = max(job.progress.total, 1)
            job.progress.current = current
            job.progress.percent = round(min(100.0, current * 100 / total), 2)
            job.progress.message = message

        await self._load_mutate(job_id, mutate)

    async def _checkpoint(self, job_id: str) -> None:
        control = self.controls[job_id]
        if control.cancel_requested:
            raise JobCancelled()
        await control.pause_gate.wait()
        if control.cancel_requested:
            raise JobCancelled()

    def _resolve_audio_options(self, audio: AudioOptions, aspect: str) -> ComposeOptions:
        music = storage.load_asset(audio.music_asset_id)
        voice = storage.load_asset(audio.voice_asset_id)
        return ComposeOptions(
            aspect=aspect,
            music_path=music.path() if music else None,
            voice_path=voice.path() if voice else None,
            music_volume=audio.music_volume,
            voice_volume=audio.voice_volume,
            source_audio_volume=audio.source_audio_volume,
            normalize_audio=audio.normalize_audio,
        )

    async def _run(self, job_id: str) -> None:
        driver: EdgeFlowDriver | None = None
        try:
            job = storage.load_job(job_id)

            def mark_running(record: JobRecord) -> None:
                record.state = JobState.RUNNING
                record.progress.message = "Starting"

            await self._load_mutate(job_id, mark_running)
            await self._emit(job_id, "info", "Starting generation pipeline", None)

            if job.request.dry_run:
                await self._emit(
                    job_id,
                    "success",
                    "Dry run complete; no Flow credits were used",
                    {
                        "lists": len(job.parsed.lists),
                        "scenes": job.parsed.scene_count,
                        "duration": job.parsed.total_duration,
                    },
                )

                def mark_dry_complete(record: JobRecord) -> None:
                    record.state = JobState.COMPLETED
                    record.progress.current = record.progress.total
                    record.progress.percent = 100
                    record.progress.message = "Dry run completed"

                await self._load_mutate(job_id, mark_dry_complete)
                return

            job_dir = storage.job_dir(job_id)
            async with self._flow_lock:
                driver = EdgeFlowDriver(
                    job.request.generation,
                    job_dir,
                    lambda level, message, data=None: self._emit(job_id, level, message, data),
                )
                await driver.connect()
                completed_units = 0

                for group_index, group in enumerate(job.parsed.lists, start=1):
                    await self._checkpoint(job_id)
                    group_dir = job_dir / f"video_{group_index:02d}"
                    clips_dir = group_dir / "clips"
                    images_dir = group_dir / "images"
                    clips_dir.mkdir(parents=True, exist_ok=True)
                    images_dir.mkdir(parents=True, exist_ok=True)
                    group_plans: list[ClipPlan] = []
                    await self._emit(
                        job_id,
                        "info",
                        f"Processing video list {group_index}/{len(job.parsed.lists)}",
                        {"scenes": len(group.scenes), "target_duration": group.total_duration},
                    )

                    for scene_index, scene in enumerate(group.scenes, start=1):
                        await self._checkpoint(job_id)

                        def set_position(record: JobRecord) -> None:
                            record.current_group = group_index
                            record.current_scene = scene_index

                        await self._load_mutate(job_id, set_position)
                        reference: Path | None = None
                        if scene.image_prompt:
                            image_path = images_dir / f"scene_{scene_index:03d}.png"
                            await self._emit(
                                job_id,
                                "info",
                                f"Scene {scene_index}: generating reference image",
                                {"prompt": scene.image_prompt},
                            )
                            reference = await driver.generate_image(scene.image_prompt, image_path)
                            completed_units += 1
                            await self._set_progress(job_id, completed_units, f"Image {scene_index} complete")

                        generated_durations = duration_chunks(scene.duration)
                        trim_durations = exact_trim_chunks(scene.duration, generated_durations)
                        for part_index, (flow_duration, trim_duration) in enumerate(
                            zip(generated_durations, trim_durations, strict=True), start=1
                        ):
                            await self._checkpoint(job_id)
                            clip_path = clips_dir / f"scene_{scene_index:03d}_part_{part_index:02d}.mp4"
                            part_prompt = scene.video_prompt
                            if part_index > 1:
                                part_prompt = (
                                    f"Continue seamlessly from the supplied final frame. {scene.video_prompt} "
                                    "Preserve subjects, wardrobe, lighting, camera direction and motion continuity."
                                )
                            await self._emit(
                                job_id,
                                "info",
                                f"Scene {scene_index}, part {part_index}: generating {flow_duration}s clip",
                                {"trim_to": trim_duration, "reference": bool(reference)},
                            )
                            clip = await driver.generate_video(
                                part_prompt,
                                flow_duration,
                                clip_path,
                                reference_image=reference,
                            )
                            group_plans.append(ClipPlan(path=clip, trim_seconds=trim_duration))

                            def add_clip(record: JobRecord, path: str = str(clip.resolve())) -> None:
                                record.clip_outputs.append(path)

                            await self._load_mutate(job_id, add_clip)
                            completed_units += 1
                            await self._set_progress(
                                job_id,
                                completed_units,
                                f"Video {group_index}, scene {scene_index}, part {part_index} complete",
                            )
                            if part_index < len(generated_durations) and job.request.generation.continue_long_scenes:
                                reference = await extract_last_frame(
                                    clip,
                                    images_dir / f"scene_{scene_index:03d}_part_{part_index:02d}_last.png",
                                )
                            else:
                                reference = None

                    if job.request.generation.auto_compose:
                        output_path = settings.output_dir / f"{job_id}_video_{group_index:02d}.mp4"
                        await self._emit(
                            job_id,
                            "info",
                            f"Composing video list {group_index}",
                            {"clips": len(group_plans), "output": str(output_path)},
                        )
                        compose_options = self._resolve_audio_options(
                            job.request.audio,
                            job.request.generation.aspect,
                        )
                        await compose_video(group_plans, output_path, group_dir / "compose", compose_options)

                        def add_output(record: JobRecord, path: str = str(output_path.resolve())) -> None:
                            record.outputs.append(path)

                        await self._load_mutate(job_id, add_output)
                        await self._emit(job_id, "success", "Final video composed", {"path": str(output_path)})

            def mark_complete(record: JobRecord) -> None:
                record.state = JobState.COMPLETED
                record.current_group = None
                record.current_scene = None
                record.progress.current = record.progress.total
                record.progress.percent = 100
                record.progress.message = "Completed"

            await self._load_mutate(job_id, mark_complete)
            await self._emit(job_id, "success", "Job completed", None)
        except JobCancelled:
            def mark_cancelled(record: JobRecord) -> None:
                record.state = JobState.CANCELLED
                record.progress.message = "Cancelled"

            await self._load_mutate(job_id, mark_cancelled)
            await self._emit(job_id, "warning", "Job cancelled", None)
        except FlowBlockedError as exc:
            def mark_blocked(record: JobRecord) -> None:
                record.state = JobState.PAUSED
                record.error = str(exc)
                record.progress.message = "Paused: Google verification required"

            await self._load_mutate(job_id, mark_blocked)
            await self._emit(job_id, "error", str(exc), {"action": "Resolve the block manually in Edge"})
        except Exception as exc:
            detail = "".join(traceback.format_exception_only(type(exc), exc)).strip()

            def mark_failed(record: JobRecord) -> None:
                record.state = JobState.FAILED
                record.error = detail
                record.progress.message = "Failed"

            await self._load_mutate(job_id, mark_failed)
            await self._emit(job_id, "error", "Job failed", {"error": detail})
        finally:
            if driver:
                await driver.disconnect()

    async def control(self, job_id: str, action: str) -> JobRecord:
        storage.load_job(job_id)
        control = self.controls.get(job_id)
        if not control:
            raise RuntimeError("This job is not active in the current server process")
        if action == "pause":
            control.pause_gate.clear()

            def mark_paused(record: JobRecord) -> None:
                if record.state == JobState.RUNNING:
                    record.state = JobState.PAUSED
                    record.progress.message = "Paused"

            await self._load_mutate(job_id, mark_paused)
            await self._emit(job_id, "warning", "Pause requested; current Flow operation may finish first", None)
        elif action == "resume":
            control.pause_gate.set()

            def mark_resumed(record: JobRecord) -> None:
                if record.state == JobState.PAUSED:
                    record.state = JobState.RUNNING
                    record.error = None
                    record.progress.message = "Running"

            await self._load_mutate(job_id, mark_resumed)
            await self._emit(job_id, "info", "Job resumed", None)
        elif action == "cancel":
            control.cancel_requested = True
            control.pause_gate.set()
            await self._emit(job_id, "warning", "Cancellation requested", None)
        else:
            raise ValueError(action)
        return storage.load_job(job_id)

    async def event_stream(self, job_id: str):
        job = storage.load_job(job_id)
        for event in job.logs[-100:]:
            yield event
        control = self.controls.get(job_id)
        if not control:
            return
        while True:
            try:
                event = await asyncio.wait_for(control.event_queue.get(), timeout=15)
                yield event
            except asyncio.TimeoutError:
                yield {"time": utc_now(), "level": "heartbeat", "message": "", "data": {}}
            current = storage.load_job(job_id)
            if current.state in {JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED} and control.event_queue.empty():
                break

    async def recompose(self, job_id: str, group_index: int | None, audio: AudioOptions) -> list[str]:
        job = storage.load_job(job_id)
        groups = [group_index] if group_index else list(range(1, len(job.parsed.lists) + 1))
        results: list[str] = []
        cursor = 0
        for index, group in enumerate(job.parsed.lists, start=1):
            plans: list[ClipPlan] = []
            for scene in group.scenes:
                durations = duration_chunks(scene.duration)
                trims = exact_trim_chunks(scene.duration, durations)
                for trim in trims:
                    if cursor >= len(job.clip_outputs):
                        raise RuntimeError("Job does not contain enough generated clips for recomposition")
                    plans.append(ClipPlan(path=Path(job.clip_outputs[cursor]), trim_seconds=trim))
                    cursor += 1
            if index not in groups:
                continue
            group_dir = storage.job_dir(job_id) / f"video_{index:02d}"
            output = settings.output_dir / f"{job_id}_video_{index:02d}_remix.mp4"
            options = self._resolve_audio_options(audio, job.request.generation.aspect)
            await compose_video(plans, output, group_dir / "recompose", options)
            results.append(str(output.resolve()))
        return results


job_manager = JobManager()
