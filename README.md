# NOVA: notebook maths tutor (Classes 8–10)

Local-first web app: write on a gridded notebook page, ask for help, and get anchored hints, checked equations and graphs on the same page. Inspired by Scribe.

See `docs/STATE.md` for current status and what is verified.

## Setup
```sh
# backend
cd server
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.lock
echo BHARATCODE_API_KEY=your_key_here > .env      # server-only; never sent to the browser
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010

# web (second terminal)
cd web
npm ci
npm run dev          # http://127.0.0.1:5180 (proxies /api to :8010; override with NOVA_BACKEND)
```
Tests: `cd server && .venv/Scripts/python -m pytest -q` · `cd web && npx tsc -b`.
