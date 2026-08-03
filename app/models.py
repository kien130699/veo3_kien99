from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class JobState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SceneSpec(BaseModel):
    image_prompt: str = ""
    video_prompt: str
    duration: float = Field(gt=0, le=600)
    line_number: int = 0


class VideoListSpec(BaseModel):
    list_index: int
    scenes: list[SceneSpec]

    @property
    def total_duration(self) -> float:
        return sum(scene.duration for scene in self.scenes)


class ParseResult(BaseModel):
    lists: list[VideoListSpec]
    warnings: list[str] = Field(default_factory=list)

    @property
    def scene_count(self) -> int:
        return sum(len(group.scenes) for group in self.lists)

    @property
    def total_duration(self) -> float:
        return sum(group.total_duration for group in self.lists)


class AudioOptions(BaseModel):
    music_asset_id: str | None = None
    voice_asset_id: str | None = None
    music_volume: float = Field(default=0.18, ge=0, le=2)
    voice_volume: float = Field(default=1.0, ge=0, le=2)
    source_audio_volume: float = Field(default=1.0, ge=0, le=2)
    normalize_audio: bool = True


class GenerationOptions(BaseModel):
    cdp_url: str = "http://127.0.0.1:9223"
    flow_url: str = "https://labs.google/fx/tools/flow"
    aspect: Literal["16:9", "9:16", "1:1"] = "16:9"
    video_model: str = "Veo 3.1 Fast"
    image_model: str = "Nano Banana 2"
    output_count: int = Field(default=1, ge=1, le=4)
    auto_compose: bool = True
    continue_long_scenes: bool = True
    keep_intermediate_images: bool = True
    download_resolution: Literal["source", "720p", "1080p"] = "source"


class CreateJobRequest(BaseModel):
    input_text: str = Field(min_length=1)
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    audio: AudioOptions = Field(default_factory=AudioOptions)
    dry_run: bool = False


class ComposeRequest(BaseModel):
    job_id: str
    group_index: int | None = None
    audio: AudioOptions = Field(default_factory=AudioOptions)


class JobProgress(BaseModel):
    current: int = 0
    total: int = 0
    percent: float = 0
    message: str = ""


class JobRecord(BaseModel):
    id: str
    state: JobState
    created_at: str
    updated_at: str
    request: CreateJobRequest
    parsed: ParseResult
    progress: JobProgress = Field(default_factory=JobProgress)
    current_group: int | None = None
    current_scene: int | None = None
    outputs: list[str] = Field(default_factory=list)
    clip_outputs: list[str] = Field(default_factory=list)
    error: str | None = None
    logs: list[dict] = Field(default_factory=list)


class AssetRecord(BaseModel):
    id: str
    kind: Literal["music", "voice", "image", "other"]
    filename: str
    stored_path: str
    size: int
    content_type: str | None = None

    def path(self) -> Path:
        return Path(self.stored_path)


class EdgeStatus(BaseModel):
    reachable: bool
    cdp_url: str
    browser: str | None = None
    version: str | None = None
    flow_tab_open: bool = False
    pages: list[str] = []
    error: str | None = None


class ValidationResponse(BaseModel):
    parsed: ParseResult
    generation_units: int
    duration_plan: list[list[list[int]]]


class ControlRequest(BaseModel):
    action: Literal["pause", "resume", "cancel"]


class UiSettingsPatch(BaseModel):
    cdp_url: str | None = None

    @field_validator("cdp_url")
    @classmethod
    def validate_cdp_url(cls, value: str | None) -> str | None:
        if value and not value.startswith(("http://127.0.0.1:", "http://localhost:")):
            raise ValueError("CDP URL must use localhost or 127.0.0.1")
        return value
