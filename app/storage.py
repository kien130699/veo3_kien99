from __future__ import annotations

import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from .config import settings
from .models import AssetRecord, JobRecord


_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_filename(name: str) -> str:
    base = Path(name).name
    sanitized = _FILENAME_SAFE.sub("_", base).strip("._")
    return sanitized[:180] or "asset.bin"


class Storage:
    def __init__(self) -> None:
        settings.ensure_directories()

    def job_dir(self, job_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("Invalid job id")
        path = settings.jobs_dir / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_job(self, job: JobRecord) -> None:
        path = self.job_dir(job.id) / "job.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(job.model_dump_json(indent=2), encoding="utf-8")
        temp.replace(path)

    def load_job(self, job_id: str) -> JobRecord:
        path = self.job_dir(job_id) / "job.json"
        if not path.exists():
            raise FileNotFoundError(job_id)
        return JobRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def list_jobs(self) -> list[JobRecord]:
        jobs: list[JobRecord] = []
        for path in settings.jobs_dir.glob("*/job.json"):
            try:
                jobs.append(JobRecord.model_validate_json(path.read_text(encoding="utf-8")))
            except Exception:
                continue
        jobs.sort(key=lambda item: item.created_at, reverse=True)
        return jobs

    async def save_upload(self, upload: UploadFile, kind: str) -> AssetRecord:
        asset_id = uuid.uuid4().hex
        filename = safe_filename(upload.filename or "asset.bin")
        asset_dir = settings.uploads_dir / asset_id
        asset_dir.mkdir(parents=True, exist_ok=False)
        stored = asset_dir / filename
        max_bytes = settings.max_upload_mb * 1024 * 1024
        size = 0
        with stored.open("wb") as handle:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    handle.close()
                    stored.unlink(missing_ok=True)
                    asset_dir.rmdir()
                    raise ValueError(f"Upload exceeds {settings.max_upload_mb} MB")
                handle.write(chunk)
        record = AssetRecord(
            id=asset_id,
            kind=kind,
            filename=filename,
            stored_path=str(stored.resolve()),
            size=size,
            content_type=upload.content_type or mimetypes.guess_type(filename)[0],
        )
        (asset_dir / "asset.json").write_text(record.model_dump_json(indent=2), encoding="utf-8")
        return record

    def load_asset(self, asset_id: str | None) -> AssetRecord | None:
        if not asset_id:
            return None
        if not re.fullmatch(r"[a-f0-9]{32}", asset_id):
            raise ValueError("Invalid asset id")
        path = settings.uploads_dir / asset_id / "asset.json"
        if not path.exists():
            raise FileNotFoundError(asset_id)
        return AssetRecord.model_validate_json(path.read_text(encoding="utf-8"))


storage = Storage()
