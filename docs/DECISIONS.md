# NOVA — decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-31 | Exact-rational evaluator behind a hand-written AST grammar instead of SymPy for `linear_x_v1` | Small, never parses arbitrary input, bounds easy to enforce |
| 2026-10-31 | Readings apply by region source hash; tutor batches by global page contentRevision | Conservative v1 staleness rule from the PRD |
| 2026-10-31 | Ports 8010 (API) / 5180 (web) | User decision; 8000/5173 belong to other processes |
| 2026-10-31 | **Graphing widened from `y = mx + b` to `graph_v2`**: any y = f(x) (powers, fractions, sqrt, abs, trig, log), equations in x (both sides drawn, crossings = solutions), lines in any form (solved for y), implicit curves (marching squares, e.g. circles) | User request: "a graph for each and every equation which we will draw". Still a safe parser (no eval), bounded size/work, discontinuities split (1/x never joined), all points computed server-side |
| 2026-10-31 | Added `arithmetic_v1` (exact Fractions, whole powers ≤ 12) for number-only lines like `3 + 2 =` | User screenshots: arithmetic lines got "no supported step". "x" between two numbers is read as multiplication |
| 2026-10-31 | Recognition: 2 independent model reads; disagreement → clarification choices instead of a silent guess | Synthetic eval 28/30 → 29/30 and fewer silent misreads; reasoning mode gave no gain and more latency |
| 2026-10-31 | Explicit Check / Next step / Graph confirms a clear displayed reading (no separate Confirm tap needed) | PRD: "explicit Check confirms the displayed reading"; removed friction seen in testing |
| 2026-10-31 | "Problem" tag auto-assigned only to an equation in x | Arithmetic lines and stray marks were being tagged as the problem |
| 2026-10-31 | Dots/specks (tiny regions) are never sent for reading; huge single strokes (scribbles) never merge into a line | Screenshots showed "Couldn't read this line" on a dot and a scribble merged with writing |
| 2026-10-31 | Clear readings are accepted automatically; NOVA reacts (answer / ✓✗ / worked solution) without a confirm step | User: "it should understand by itself whether it is right or wrong"; Edit remains, disagreement still asks |
| 2026-10-31 | Auto-answer on by default (Settings switch; off = marks only) and disabled on question-paper pages during a test | User request; tests must not be answered by NOVA |
| 2026-10-31 | SymPy added (expr_v2) behind our own tokenizer/parser, in a time-limited worker process | "Each and every piece of maths" with exact answers; still no eval/parse_expr on user text |
| 2026-10-31 | Handwriting via a built-in stroke glyph set + optional personal glyph samples; no generative model training | User agreed ("handwriting only"); 4 GB GPU is too small for a useful generator |
| 2026-10-31 | Content NOVA writes (tables, lists, answer keys) is verified by the engine and corrected before writing | A "PhD" persona must not write wrong values |
| 2026-10-31 | UI identity: warm paper/desk, serif titles, fountain-pen blue for NOVA; Inter + Instrument Serif bundled locally | User: previous UI too generic; still within PRD (no gradients/glass/mascot) |
| 2026-10-31 | Student theme (theme-student.css): white + soft blue grid, vivid blue NOVA, sun/mint/coral accents, Nunito; replaces the beige/serif look | User: beige "premium" look doesn't suit students |
| 2026-10-31 | App starts on a Home screen (Continue card with the real last page, quick actions New notebook / Take a test / Ask NOVA, notebooks with real page previews, tests with scores) | User: bookshelf home made no sense; supersedes PRD "open the last page directly" |
| 2026-10-31 | Replaced the colourful student theme with a restrained tool look (theme.css) and a Home built from real activity (recent pages, weekly writing, right/to-fix counts, lines to review, tests) | User: previous UI looked AI-generated; plain library looked empty |
| 2026-10-31 | Home is a writable scratch page with notebooks pinned on its grid (user picked this over a big-preview home and a daily-challenge home) | Previous homes felt empty or templated |
| 2026-10-31 | NOVA speaks replies only when the question was asked by voice ("Always speak" setting remains) | User choice; marks/answers on the page stay silent |
| 2026-10-31 | Reverted the UI to the original first design (theme-classic.css, original Notebooks list, open last notebook directly); all features kept | User: the redesigns did not work; wanted the first UI back |
| 2026-10-31 | Worked solutions show what crossed = with red arrows and short notes | User: a beginner cannot follow bare steps |
| 2026-10-31 | Notebooks tiles show real page previews; continue card; UI sized up | User: thumbnails should preview the notebook; screen looked empty and small |
