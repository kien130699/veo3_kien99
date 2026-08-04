from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = os.getenv("VEO_HOST", "127.0.0.1")
    port: int = int(os.getenv("VEO_PORT", "8765"))
    cdp_url: str = os.getenv("VEO_CDP_URL", "http://127.0.0.1:9223")
    flow_url: str = os.getenv(
        "VEO_FLOW_URL", "https://labs.google/fx/vi/tools/flow?hl=vi"
    )
    operation_timeout_ms: int = int(os.getenv("VEO_OPERATION_TIMEOUT_MS", "30000"))
    submit_observe_ms: int = int(os.getenv("VEO_SUBMIT_OBSERVE_MS", "12000"))
    mock_flow: bool = os.getenv("VEO_MOCK_FLOW", "0") == "1"
    data_dir: Path = Path(os.getenv("VEO_DATA_DIR", "data"))

    @property
    def log_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def screenshot_dir(self) -> Path:
        return self.data_dir / "screenshots"


settings = Settings()
settings.log_dir.mkdir(parents=True, exist_ok=True)
settings.screenshot_dir.mkdir(parents=True, exist_ok=True)
