# NOVA — build state

_Last updated: 2026-10-31 (session 1, evening)_

## Running
| Process | URL | Command |
|---|---|---|
| Backend (FastAPI) | http://127.0.0.1:8010 | `cd server && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010` |
| Web (Vite) | **http://127.0.0.1:5180** | `cd web && npm run dev` |

**At the end of this session the backend was stopped by Claude Code because the PC ran low on memory.** Start it again with the command above (the web dev server may still be running; if not, start it too). No auto-reload: restart the backend after server code changes.
Secrets: `server/.env`. Speech model: `server/models/` (`scripts/setup_speech.py`). Ports 8000/5173 belong to other processes; leave them alone.

## Checks (last run)
| Check | Result |
|---|---|
| `server: .venv/Scripts/python -m pytest -q` | **191 passed** |
| `web: npx vitest run` | 14 passed |
| `web: npx tsc -b` / `npm run build` | clean / ok |
| Browser journeys `tests/e2e/{journey,auto,ask_table,paper,handwriting}.mjs` | pass (see RESULTS.md) |
| Real human handwriting (T02) | **NOT RUN** |

## What NOVA does now
- **Reads automatically**, two independent reads; disagreement → "Which did you write?"; agreement → accepted (Edit stays available). No confirm step.
- **Reacts by itself** (exact maths, no AI guessing): `… =` → answer written in handwriting beside "="; `a = b` → ✓/✗; equation → full worked solution in handwriting under/next to it; step under a problem → ✓/✗; `y = …` → Graph action. Auto-answer can be turned off in Settings (then marks only).
- **Exact maths engine (expr_v2, SymPy behind our own parser)**: arithmetic, fractions, powers, roots, trig in degrees, identities, expand/factorise, d/dx, ∫ (incl. definite), limits, n!, nCr, gcd/lcm, %, logs, |x|, equations/inequalities (quadratics, trig with 0°–360° solutions), step equivalence for any equation.
- **Graphs** for any equation (functions, both sides of an equation with the solution marked, implicit curves).
- **Handwriting engine** (`web/src/handwriting/`): built-in glyphs for digits, letters, Greek, operators, √, ∫, fractions, powers; style copied from the student's line. **Teach NOVA your handwriting** (Settings): guided boxes for digits/operators/x/y/θ/√/✓/✗; samples stored on this device (deletable); NOVA then composes answers from them, falling back to built-in glyphs.
- **Ask NOVA** is a docked chat thread (replyable), general questions are about the page, not the last line. NOVA can write handwritten content (lists, tables) onto the page; every value is verified/corrected by the engine. Persona: professor-level mathematician (no real-institution claims).
- **Question papers (PDF)**: Page options/overflow → Import question paper. pdf.js renders pages + text layer; NOVA finds questions, locates them, builds an answer key verified by the engine; Test panel: Help (hint + circle, never the answer), Finish test (reads answers under each question, marks ✓/✗ on the page, red score at the top, review with Explain).
- **Endless grid**: blank pages fill the screen with the grid (no paper edge) and grow right/down as you write or scroll; imported PDFs/photos keep their page shape. Zoom % resets to 100% at the top-left.
- **Answer placement** follows the student's last symbol (the "="), level with it, so slanted lines work (issue I3.png); stray dots are ignored.
- **Question papers, round 2**: pages are read 2 at a time with one automatic retry; failed pages are listed with a Retry button (images re-read from storage). Circled/ticked printed options are read from the PDF text positions (no model). The help circle is a thin blue outline. The PDF sheet lies on the endless grid; explanations are written in the grid beside the sheet, level with the question, in teacher inks (black = question/given, blue = working, red = key idea + final answer).
- **UI**: back to the ORIGINAL first-build look (user request): grey workspace, white top bar (‹ Notes), fixed 48px writing toolbar, system font, accent #245C9C, original Notebooks list; app opens the last notebook directly. theme-classic.css restores those surfaces over index.css. Later redesigns (warm, student, neutral, Home-as-a-page) are removed from the UI; features (handwriting answers, tests, Ask thread, grid) are kept in the original style.
- **Voice replies**: a question asked through the mic is answered aloud (and in writing); typed questions stay silent unless "Always speak" is on in Settings.
- QA_REVIEW.md bugs 1–4 fixed (menu collision, readback overlap, stale-card stacking, menu over graph).

## Known gaps / next
2. Real handwriting evaluation with people's writing (Day 1 exit) — still the main open gate.
4. Scanned (image-only) PDFs rely on model bounding boxes; not tested.
5. Browser mic (webm/opus) on a real device; HTTPS for phone mic.
6. KaTeX bundle size warning.

- **Beginner worked solutions** (2026-10-31): linear equations are solved with explained steps (server maths/steps.py explained_steps → /auto notes + moves). On the page each moved term is red, a red curved arrow runs from where it was to where it landed (side-aware across =), a thin handwritten note says why ("+2 moves across = and becomes -2", "11 - 2 = 9"), final answer red. Client: handwriting/explain.ts; notes are a separate thin-pen ink object (id suffix :why).
- **Notebooks screen** (2026-10-31): real page previews on every tile (PageThumb), a large "Continue where you left off" card (preview, first lines NOVA read, ✓/✗ counts, Continue writing), New notebook + Import a question paper cards. Whole UI one step bigger (60px top bar, 58px toolbar, 22px icons).
- **Solve button = explained solution** (2026-10-31): the readback/menu Solve on a linear equation now calls /auto (forced) and writes the same arrowed, noted solution as auto-answer (useNova.solveHere); other equations still go to the tutor. Non-whole answers end with an x ≈ decimal line.
