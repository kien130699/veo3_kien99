from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


Mode = Literal["current", "image", "video"]


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=5000)
    mode: Mode = "current"
    create_project_if_needed: bool = True

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Prompt không được để trống")
        return value


class ScanResult(BaseModel):
    ok: bool = True
    connected: bool
    page_url: str | None = None
    page_title: str | None = None
    editor_found: bool = False
    project_button_found: bool = False
    submit_found: bool = False
    submit_enabled: bool = False
    submit_text: str | None = None
    mode_controls: list[str] = []
    screenshot: str | None = None
    message: str = ""


class GenerateResult(BaseModel):
    ok: bool
    mode: Mode
    page_url: str | None = None
    prompt_length: int
    project_opened: bool = False
    mode_switched: bool = False
    editor_verified: bool = False
    submit_clicked: bool = False
    submit_signal: str | None = None
    screenshot: str | None = None
    message: str
