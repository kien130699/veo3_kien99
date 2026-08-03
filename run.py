from __future__ import annotations

import threading
import time
import webbrowser

import uvicorn

from app.config import settings


def open_ui() -> None:
    time.sleep(1.2)
    webbrowser.open(f"http://{settings.host}:{settings.port}")


if __name__ == "__main__":
    threading.Thread(target=open_ui, daemon=True).start()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
