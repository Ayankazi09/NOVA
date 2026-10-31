"""Opt-in LIVE recognition evaluation (spends BharatCode tokens).

Renders held-out maths lines in handwriting-style system fonts with random slant/jitter,
sends them through the real recognition service, and reports exact-match accuracy.
This is SYNTHETIC handwriting: useful for comparing prompts/settings, NOT T02 evidence.

    server/.venv/Scripts/python tests/live/eval_recognition.py [--votes 1|2] [--effort low] [--n 30]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import os
import random
import re
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

EXPRESSIONS = [
    "2x + 3 = 14", "2(x + 3) = 14", "3 + 2 =", "12 - 7 = 4", "x = 4", "3x - 5 = 10", "y = 2x + 1", "y = x^2 - 4",
    "5x + 2 = 3x + 8", "x/2 + 1 = 4", "4(x - 1) = 12", "0.5x = 3", "-2x + 6 = 0", "7 * 8 =", "9 - 3 = 6",
    "x + 3 = 7", "2x = 11", "y = -3x + 5", "6 / 2 = 3", "10x = 50", "3(x + 2) = 21", "x^2 + y^2 = 25", "2x - 7 = 1",
    "15 + 27 =", "y = 1/x", "8 - x = 3", "(x + 1)(x - 1) = 0", "1.5 + 2.5 = 4", "x - 9 = -4", "4x + 4 = 2x",
]
FONTS = ["Inkfree.ttf", "segoepr.ttf", "comic.ttf", "mvboli.ttf"]


def to_display(expr: str) -> str:
    s = expr.replace("*", "\u00d7")
    return re.sub(r"\^(\d)", lambda m: "\u00b2" if m.group(1) == "2" else "\u00b3" if m.group(1) == "3" else "^" + m.group(1), s)


def render(expr: str, font_file: str, rng: random.Random) -> str:
    text = to_display(expr)
    size = rng.randint(54, 72)
    font = ImageFont.truetype(str(Path("C:/Windows/Fonts") / font_file), size)
    w = int(font.getlength(text)) + 120
    h = size * 2 + 40
    im = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(im)
    x = 50
    for ch in text:  # per-character baseline jitter like real handwriting
        d.text((x, 40 + rng.randint(-5, 5)), ch, fill=rng.randint(10, 50), font=font)
        x += font.getlength(ch) + rng.randint(-2, 5)
    im = im.rotate(rng.uniform(-3, 3), expand=True, fillcolor=255)
    im = im.transform(im.size, Image.AFFINE, (1, rng.uniform(-0.15, 0.15), 0, 0, 1, 0), fillcolor=255)
    im = im.convert("RGB")
    im.thumbnail((1600, 1600))
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s).replace("\u00d7", "*").lower()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--votes", default="2")
    ap.add_argument("--effort", default="")
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    os.environ["NOVA_RECOGNIZE_VOTES"] = args.votes
    os.environ["NOVA_RECOGNIZE_EFFORT"] = args.effort
    from app import services
    from app.errors import ApiError
    from app.providers.bharatcode import provider
    from app.schemas.models import RecognizeRequest, RequestContext

    rng = random.Random(args.seed)
    cases = [(e, FONTS[i % len(FONTS)]) for i, e in enumerate(EXPRESSIONS[: args.n])]
    sem = asyncio.Semaphore(4)
    rows = []

    async def one(expr, font):
        png = render(expr, font, rng)
        ctx = RequestContext(requestId=uuid.uuid4(), pageId="eval", contentRevision=0, regionId="r", sourceHash="h", selectionRevision=0, interpretationRevision=0)
        async with sem:
            t0 = time.perf_counter()
            try:
                r = await services.recognize(RecognizeRequest(context=ctx, regionPng=png, regionWidth=600, regionHeight=120))
                got, alts, clar = r.rawText, r.alternatives, r.needsClarification
            except ApiError as e:
                got, alts, clar = f"<{e.code}>", [], False
            dt = time.perf_counter() - t0
        exact = norm(got) == norm(expr)
        in_alts = exact or any(norm(a) == norm(expr) for a in alts)
        rows.append((expr, font, got, exact, in_alts, clar, dt))

    t0 = time.perf_counter()
    await asyncio.gather(*[one(e, f) for e, f in cases])
    await provider.aclose()
    rows.sort(key=lambda r: EXPRESSIONS.index(r[0]))
    exact = sum(r[3] for r in rows)
    alts = sum(r[4] for r in rows)
    silent_wrong = sum(1 for r in rows if not r[3] and not r[5])
    lat = sorted(r[6] for r in rows)
    print(f"votes={args.votes} effort={args.effort or 'none'} n={len(rows)}  exact={exact}/{len(rows)} ({100*exact/len(rows):.0f}%)  "
          f"correct-in-options={alts}/{len(rows)}  wrong-without-clarification={silent_wrong}  "
          f"p50={lat[len(lat)//2]:.1f}s p95={lat[int(len(lat)*0.95)-1]:.1f}s wall={time.perf_counter()-t0:.0f}s")
    for expr, font, got, ex, ia, clar, dt in rows:
        if not ex:
            print(f"  MISS {expr!r:24} -> {got!r:26} {'(in options)' if ia else ''} {'[asked]' if clar else '[SILENT]'} {font}")


if __name__ == "__main__":
    asyncio.run(main())
