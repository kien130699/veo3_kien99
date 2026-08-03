from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("VEO_HOST", "127.0.0.1")
    port: int = int(os.getenv("VEO_PORT", "8765"))
    cdp_url: str = os.getenv("VEO_CDP_URL", "http://127.0.0.1:9223")
    flow_url: str = os.getenv("VEO_FLOW_URL", "https://labs.google/fx/tools/flow")
    data_dir: Path = Path(os.getenv("VEO_DATA_DIR", ROOT_DIR / "data")).resolve()
    output_dir: Path = Path(os.getenv("VEO_OUTPUT_DIR", ROOT_DIR / "output")).resolve()
    ffmpeg_bin: str = os.getenv("FFMPEG_BIN", "ffmpeg")
    ffprobe_bin: str = os.getenv("FFPROBE_BIN", "ffprobe")
    mock_flow: bool = os.getenv("VEO_MOCK_FLOW", "0").strip().lower() in {"1", "true", "yes", "on"}
    flow_timeout_seconds: int = int(os.getenv("VEO_FLOW_TIMEOUT", "480"))
    max_upload_mb: int = int(os.getenv("VEO_MAX_UPLOAD_MB", "500"))

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    def ensure_directories(self) -> None:
        for path in (self.data_dir, self.jobs_dir, self.uploads_dir, self.output_dir):
            path.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_directories()
