from __future__ import annotations

import base64
import hashlib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTS_DIR = ROOT / "source_archive"
ZIP_PATH = ROOT / "veo3_kien99_v2.zip"
EXPECTED_SHA256 = "c0fec3147b99f904d0781268faca89330373395ac591a3f72d1a75dcafd9576f"


def main() -> None:
    parts = sorted(PARTS_DIR.glob("part*.b64"))
    if len(parts) != 4:
        raise SystemExit(f"Expected 4 archive parts, found {len(parts)}")

    encoded = "".join(part.read_text(encoding="utf-8").strip() for part in parts)
    archive = base64.b64decode(encoded, validate=True)
    actual = hashlib.sha256(archive).hexdigest()
    if actual != EXPECTED_SHA256:
        raise SystemExit(
            f"SHA-256 mismatch: expected {EXPECTED_SHA256}, received {actual}"
        )

    ZIP_PATH.write_bytes(archive)
    with zipfile.ZipFile(ZIP_PATH, "r") as bundle:
        bundle.testzip()
        bundle.extractall(ROOT)

    print(f"Created: {ZIP_PATH}")
    print(f"Extracted: {ROOT / 'veo3_kien99_v2'}")
    print(f"SHA-256: {actual}")


if __name__ == "__main__":
    main()
