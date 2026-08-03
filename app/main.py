from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import ROOT_DIR, settings
from .edge_flow import EdgeFlowDriver
from .jobs import job_manager
from .models import (
    ComposeRequest,
    ControlRequest,
    CreateJobRequest,
    ValidationResponse,
)
from .parser import PromptFormatError, duration_chunks, parse_prompt_lists
from .storage import safe_filename, storage


app = FastAPI(
    title="Veo3 Kien99",
    version="0.1.0",
    description="Local Edge-CDP Google Flow queue and video compositor",
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "version": "0.1.0",
        "mock_flow": settings.mock_flow,
        "default_cdp_url": settings.cdp_url,
        "output_dir": str(settings.output_dir),
        "gflow_pin": "v0.49.0",
        "automation_mode": "UI-only; no direct private generation API",
    }


@app.get("/api/edge/status")
async def edge_status(cdp_url: str = Query(default=settings.cdp_url)):
    return await EdgeFlowDriver.status(cdp_url)


@app.post("/api/validate", response_model=ValidationResponse)
async def validate_input(request: CreateJobRequest) -> ValidationResponse:
    try:
        parsed = parse_prompt_lists(request.input_text)
    except PromptFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    plan: list[list[list[int]]] = []
    units = 0
    for group in parsed.lists:
        group_plan: list[list[int]] = []
        for scene in group.scenes:
            chunks = duration_chunks(scene.duration)
            group_plan.append(chunks)
            units += len(chunks) + (1 if scene.image_prompt else 0)
        plan.append(group_plan)
    return ValidationResponse(parsed=parsed, generation_units=units, duration_plan=plan)


@app.post("/api/assets")
async def upload_asset(
    kind: Literal["music", "voice", "image", "other"] = Query(...),
    file: UploadFile = File(...),
):
    try:
        return await storage.save_upload(file, kind)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc


@app.post("/api/jobs")
async def create_job(request: CreateJobRequest):
    try:
        return await job_manager.create(request)
    except PromptFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/jobs")
async def list_jobs():
    return job_manager.list()


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    try:
        return job_manager.get(job_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.post("/api/jobs/{job_id}/control")
async def control_job(job_id: str, request: ControlRequest):
    try:
        return await job_manager.control(job_id, request.action)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str):
    try:
        storage.load_job(job_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc

    async def stream():
        async for event in job_manager.event_stream(job_id):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/compose")
async def compose(request: ComposeRequest):
    try:
        outputs = await job_manager.recompose(request.job_id, request.group_index, request.audio)
        return {"outputs": outputs}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job or asset not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/outputs/{filename}")
async def get_output(filename: str):
    filename = safe_filename(filename)
    path = (settings.output_dir / filename).resolve()
    if path.parent != settings.output_dir.resolve() or not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Output not found")
    return FileResponse(path, filename=path.name, media_type="video/mp4")
