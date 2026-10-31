"""Explicitly download the local speech model and benchmark it once.

Usage (from repo root):
    server/.venv/Scripts/python scripts/setup_speech.py [model]   # default base.en

The model is stored in server/models/ and the download is recorded in docs/RESULTS.md.
The server itself never downloads models implicitly.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "server" / "models"


def main() -> None:
    from faster_whisper import WhisperModel

    name = sys.argv[1] if len(sys.argv) > 1 else "base.en"
    MODELS.mkdir(parents=True, exist_ok=True)
    print(f"Downloading/loading faster-whisper '{name}' (CPU int8) into {MODELS} ...")
    t0 = time.perf_counter()
    model = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(MODELS))
    load_s = time.perf_counter() - t0

    # 3 s of silence-ish noise: just measures the pipeline, not accuracy
    import numpy as np

    audio = (np.random.default_rng(0).standard_normal(16000 * 3) * 0.001).astype("float32")
    t1 = time.perf_counter()
    segs, _ = model.transcribe(audio, beam_size=1, vad_filter=False)
    list(segs)
    run_s = time.perf_counter() - t1
    size_mb = sum(f.stat().st_size for f in MODELS.rglob("*") if f.is_file()) / 1e6
    print(f"ok: load {load_s:.1f}s, 3s synthetic clip {run_s:.2f}s, models dir {size_mb:.0f} MB")

    results = ROOT / "docs" / "RESULTS.md"
    line = (
        f"| {datetime.now():%Y-%m-%d %H:%M} | speech setup | faster-whisper `{name}` cpu/int8 downloaded to server/models "
        f"({size_mb:.0f} MB) | load {load_s:.1f}s; 3s synthetic clip {run_s:.2f}s | synthetic benchmark only, not accuracy evidence |\n"
    )
    if not results.exists():
        results.write_text(
            "# NOVA — observed results\n\nOnly measured evidence goes here. Everything else is NOT RUN.\n\n"
            "| When | Test | Setup | Observed | Notes |\n|---|---|---|---|---|\n",
            encoding="utf-8",
        )
    with results.open("a", encoding="utf-8") as f:
        f.write(line)


if __name__ == "__main__":
    main()
