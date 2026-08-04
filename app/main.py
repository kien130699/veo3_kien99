from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import settings
from .flow import (
    FlowConnectionError,
    FlowController,
    FlowError,
    FlowSelectorError,
    MockFlowController,
)
from .models import GenerateRequest, GenerateResult, ScanResult


STATIC_DIR = Path(__file__).parent / "static"
controller: FlowController | MockFlowController = (
    MockFlowController(settings) if settings.mock_flow else FlowController(settings)
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await controller.close()


app = FastAPI(
    title="Veo3 Kien99 V1 Clean",
    version=__version__,
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "version": __version__,
        "host": settings.host,
        "port": settings.port,
        "cdp_url": settings.cdp_url,
        "mock_flow": settings.mock_flow,
    }


@app.post("/api/scan", response_model=ScanResult)
async def scan() -> dict[str, object]:
    try:
        return await controller.scan()
    except FlowConnectionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FlowSelectorError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FlowError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/generate", response_model=GenerateResult)
async def generate(request: GenerateRequest) -> dict[str, object]:
    try:
        return await controller.generate(
            prompt=request.prompt,
            mode=request.mode,
            create_project_if_needed=request.create_project_if_needed,
        )
    except FlowConnectionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FlowSelectorError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FlowError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
