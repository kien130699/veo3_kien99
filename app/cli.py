from __future__ import annotations

import argparse
import webbrowser

import uvicorn

from .config import settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Veo3 Kien99 local server")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not args.no_browser:
        webbrowser.open(f"http://{args.host}:{args.port}")
    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
