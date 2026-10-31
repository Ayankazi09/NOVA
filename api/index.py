"""Vercel entry point: the NOVA FastAPI server as one Python function (all /api/* requests are routed here)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

from app.main import app  # noqa: E402,F401
