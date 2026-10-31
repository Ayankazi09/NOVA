# NOVA — QA & Verification Review

**Date**: 2026-10-31  
**Reviewer**: Antigravity Independent QA Review  
**Target Build**: Commit baseline running on `http://127.0.0.1:5180` (Vite dev) and `http://127.0.0.1:8010` (FastAPI backend)  
**Evidence Source**: Live browser interaction session via Playwright browser subagent, real canvas pointer events, live backend API calls with configured BharatCode Qwen vision model. All results are measured from direct interaction; no results or claims are invented.

---

## Executive Summary

The NOVA application was subjected to an extensive, end-to-end interactive quality review across desktop (1200×800) and mobile (390×844) viewports.

### Key Milestones Verified:
1. **Professional Notes App Aesthetic**: NOVA opens immediately into a quiet, focused gridded notebook page with zero splash/dashboard detour, no hero banners, and no permanent chat sidebar. Writing area occupies over 80% of the viewport.
2. **Core Inking & Persistence**: Pen (vector ink, variable pressure), true stroke eraser, selection (box & lasso), undo/redo (toolbar + shortcuts `Ctrl+Z`, `Ctrl+Y`), pan, zoom (% indicator with fit-width), and transactional IndexedDB persistence were validated. Reloading the browser completely restored ink geometry and page state without data loss. Existing user work was preserved in a separate test notebook (`QA Test Notebook`).
3. **Real Handwriting Perception (T02)**: **Verified with live BharatCode vision model**. Handwritten `2(x+3)=14` was recognized accurately. Crucially, the intentionally incorrect student working `2x+3=14` was **read literally** without auto-correcting to `2x+6=14`.
4. **Pedagogical AI & Deterministic Mathematics**: When checking `2x+3=14` against `2(x+3)=14`, the system flagged `Different solution from the problem` and generated an anchored, non-revealing hint (`2(x+3) means 2 multiplies everything inside...`).
5. **Revision Invalidation & Stale Safety (T04)**: Erasing `3` from `2x+3=14` immediately invalidated the derived check badge and marked the tutor card `Outdated` (translucent with an amber tag), guaranteeing stale AI advice does not linger as valid guidance.
6. **Next-Step Completion & Graphing**: Step completion generated KaTeX-rendered `2x = 8` verified by deterministic checking. Linear function `y = 2x + 1` produced a full Cartesian coordinate graph with axes, grid lines, and intercept markers.
7. **Issues Found**: Identified four visual overlap / layout collisions where floating menus, completion cards, and graphs collide with readback chips, previous ink, or stale cards.

---

## 1. Professional Notes App Feel & Aesthetic Restraint

| Criterion | Target Requirement (PRD 03 / 03A) | Observed Behaviour | Status |
|---|---|---|---|
| **Entry Experience** | Open last page directly; no dashboard detour, welcome card, or hero headline | App boots straight into the notebook surface (`Maths practice` or last opened notebook) without intermediate cards or onboarding splash. | **PASS** |
| **Grid Surface** | White page on `#F3F4F6` workspace, default square grid 24 units, major lines 120 units; `#E8ECF0` fine, `#DCE2E8` major | Sharp crisp canvas lines drawn at DPR, minor spacing suppressed gracefully at low scales. Workspace background is `#F3F4F6`. | **PASS** |
| **Top Bar** | 52px desktop / 48px phone, 1px bottom border, editable 16px title, quiet save status, overflow menu | Matches spec: `< Notes`, editable title input, `Saved` / `Saving…`, `Page n of m`, overflow `…`. | **PASS** |
| **Writing Toolbar** | 48px desktop/tablet; Pen, Eraser, Select, Pan, popovers, Undo/Redo, Zoom, Assist toggle, History, Ask NOVA, Mic | Compact toolbar with 44px hit areas, 18–20px line icons, subtle neutral active indicators, no glowing pills. | **PASS** |
| **Chat Absence** | No permanent chat sidebar or AI avatar; contextual AI beside the work | No permanent sidebar. History drawer is closed by default (300px on-demand rail). AI hints anchor adjacent to writing. | **PASS** |
| **Viewport Allocation** | ≥80% of usable desktop/tablet width with panels closed | With rails closed, writing workspace takes 100% of body width beneath the 100px combined top/tool bars. | **PASS** |

---

## 2. Core Notebook Tools & Persistence

All tests were conducted inside a dedicated test notebook named **`QA Test Notebook`** to preserve pre-existing notebooks (`Maths practice` remained completely intact).

### Test 2.1: Vector Pen Inking
- **Reproduction**: Selected Pen tool; varied colours (Charcoal `#20252B`, Blue `#245C9C`, Red `#B3261E`) and widths. Drew equation strokes for `2(x+3)=14` and `2x+3=14`.
- **Expected**: Smooth vector strokes committed to page coordinate space on pointer-up; responsive drawing without blocking network calls.
- **Observed**: Strokes rendered immediately via live canvas overlay and committed to main ink canvas on pointer-up. Point coalescing and Douglas-Peucker simplification maintained sharp handwriting without lag.
- **Status**: **PASS**

### Test 2.2: Stroke Eraser
- **Reproduction**: Selected Eraser tool; swept pointer across a stroke.
- **Expected**: Stroke-delete behavior (touching any part of a stroke removes the entire stroke).
- **Observed**: Hovered/intersected strokes turned translucent (opacity 0.18) during drag, and completely deleted upon pointer-up.
- **Status**: **PASS**

### Test 2.3: Undo & Redo (Toolbar & Keyboard)
- **Reproduction**:
  1. Drew strokes -> clicked Toolbar Undo button -> verified stroke vanished.
  2. Clicked Toolbar Redo button -> verified stroke reappeared.
  3. Pressed `Ctrl+Z` on keyboard -> stroke vanished.
  4. Pressed `Ctrl+Y` and `Ctrl+Shift+Z` -> stroke reappeared.
- **Expected**: Monotonic, deterministic undo/redo history.
- **Observed**: Toolbar button enabled/disabled states tracked history stack accurately. Keyboard events ignored when inputs/textareas focused.
- **Status**: **PASS**

### Test 2.4: Selection Tool (Lasso & Box)
- **Reproduction**: Selected Select tool. Tested bounding-box drag around strokes, tap on individual stroke, and lasso path.
- **Expected**: Region bounds calculated; dashed selection rectangle `#245C9C` appears with floating action menu.
- **Observed**: Tap accurately resolved stroke cluster. Drag created a selection region and opened the anchored `RegionMenu` (`Ask`, `Read`, `Check`, `Set as problem`, `X`).
- **Status**: **PASS**

### Test 2.5: Pan, Zoom & Coordinate Invariance
- **Reproduction**: Used Pan tool and Zoom indicator (`100%` / fit-width). Checked visual alignment of grid, ink strokes, and tutor annotations.
- **Expected**: Grid, ink, selection, and tutor cards share the exact same view transform; no drift or misalignment.
- **Observed**: `Workspace.tsx` applies identical `scale`, `tx`, `ty` across paper canvas, ink canvas, and SVG/HTML overlays. No spatial drift observed during pan or zoom.
- **Status**: **PASS**

### Test 2.6: Local Persistence & Reload Recovery
- **Reproduction**: Verified `Saved` indicator in top bar. Triggered hard browser refresh (`location.reload()`).
- **Expected**: Restores exact notebook title, page index, strokes, and region readings from IndexedDB.
- **Observed**: Notebook reloaded into `QA Test Notebook`, Page 2; all strokes, readback chips, and tutor cards rendered at exact identical coordinates.
- **Status**: **PASS**

---

## 3. Desktop vs. Mobile Layouts & Viewport Review

### Desktop Viewport (≥1100px)
- **Pages Rail**: Opens on demand at 208px width on the left. In flex layout, it pushes the workspace cleanly without obscuring canvas content. Shows live thumbnail previews of each page with strokes.
- **History Drawer**: Opens on demand at 300px on the right. Shows chronological student/tutor turns.
- **Both Panels Open**: Workspace scales gracefully between the rails.

### Phone Viewport (<700px, tested at 390×844)
- **Top Bar**: Collapsed to 48px with compact title and navigation.
- **Bottom Tool Dock**: Positioned at bottom (`56px` + safe-area padding). Contains Pen, Eraser, Undo, Ask NOVA, Mic, and More (`…`).
- **More Popover**: Opens from dock (`.dock-pop`) showing secondary tools: Select, Pan, Redo, Fit width, Colour swatches, Width buttons, Assist toggle, Pages, NOVA history, and Page options.
- **Pages Drawer on Phone**: Opens as an overlay drawer (`.pages-rail.drawer`) with shadow and close button, allowing quick page navigation.
- **Writing Space**: Unobstructed by default. Finger drawing works directly on the canvas; Pan and Zoom reachable.

---

## 4. Real Handwriting Recognition (BharatCode Vision)

> **Important**: This test was run against the live `qwen-3.8-27b` model via `https://bharatcode.ai/api/model/v1` with the server-configured API key.

### Test 4.1: Problem Equation Recognition
- **Handwritten Input**: `2(x + 3) = 14` drawn on Page 2 with stylus/pen strokes.
- **Observed Readback**: `I read: 2(x+3)=14 [Confirm] [Edit]`
- **Evaluation**: Literal match. All parentheses, plus sign, and equals sign correctly transcribed without character drop or hallucination.

### Test 4.2: Unseen Incorrect Working Step (PRD Non-Negotiable Test)
- **Handwritten Input**: Student wrote `2x + 3 = 14` (distributing the 2 to `x` only, forgetting the `3`).
- **Observed Readback**: `I read: 2x + 3 = 14 [Confirm] [Edit]`
- **Evaluation**: **CRITICAL PASS**. The recogniser preserved the student's mistake literally. It **did not** "repair" the expression to `2x + 6 = 14`.

### Test 4.3: Linear Function for Graphing
- **Handwritten Input**: `y = 2x + 1` drawn on Page 3.
- **Observed Readback**: `I read: y = 2x + 1 [Confirm] [Edit]`
- **Evaluation**: Exact match. The system detected the `y =` prefix and dynamically displayed the `Graph` action in the selection menu.

### Test 4.4: Ambiguous Writing & Clarification UX (T03)
- **Handwritten Input**: An isolated digit / stroke `3` drawn without context.
- **Observed Readback**: Displayed clarification card:
  `Which did you write? [ 3 ] [ (3 ] [ B ] [Other]`
- **Evaluation**: **PASS**. Uncertain notation was not awarded an unverified badge. The learner is given direct 1-tap disambiguation chips without modal interruption.

---

## 5. Pedagogical Tutoring, Step Checking & Invalidation

### Test 5.1: Deterministic Step Checking (`Check`)
- **Problem Region**: `2(x+3)=14`
- **Current Step**: `2x+3=14`
- **Action**: Clicked `Check` in the region menu.
- **Result**:
  - Readback badge: `2x + 3 = 14 Different solution from the problem Edit` (styled with red accent).
  - Region highlight: Red boundary box surrounding the student's incorrect step.
  - Tutor Card:
    ```
    NOVA
    2(x+3) means 2 multiplies everything inside. Multiply 2 by x AND by 3, then rewrite the line.
    ```
  - Toast: `NOVA added 2 items. [Undo]`
- **Evaluation**: Targeted pedagogical hint provided without revealing `x = 4`.

### Test 5.2: Invalidation & Stale Safety on Ink Revision (T04)
- **Action**: With the hint visible on the page, switched to Eraser and erased `3` from `2x+3=14`. Switched to Pen and drew `6`.
- **Observed Reaction**:
  - The tutor card immediately turned translucent (`opacity: 0.55`) and displayed an amber **`Outdated`** tag with tooltip *"Your work changed after this was written"*.
  - The previous `Different solution from the problem` badge was cleared.
  - The readback updated to `Reading…` then `2 x + 6 = 14`.
- **Evaluation**: **PASS**. Meets interaction invariant: any student ink revision immediately invalidates derived checks and marks advice outdated.

### Test 5.3: Correct Step Re-Check
- **Action**: Confirmed `2x + 6 = 14` and clicked `Check`.
- **Result**:
  - Readback badge updated to blue: `2x + 6 = 14 Same solution as the problem Edit`.
  - Tutor Card added: `This line keeps the same solution as the problem.`
- **Evaluation**: **PASS**. Exact-rational symbolic engine confirmed mathematical equivalence.

### Test 5.4: Next-Step Mathematical Completion
- **Action**: Clicked `Next step` on `2x + 6 = 14`.
- **Result**:
  - Tutor Card added:
    ```
    NOVA · next step  [checked]
    2x = 8
    ```
    rendered in KaTeX mathematics.
  - Accompanying note: *"The check confirms 2x + 6 = 14 is equivalent to the original equation... Now isolate x by moving the constant to the other side."*
- **Evaluation**: **PASS**. Step is verified deterministically before insertion; never auto-inserted into student ink.

### Test 5.5: Linear Graphing (`plot_function`)
- **Action**: Selected `y = 2x + 1` and clicked `Graph`.
- **Result**:
  - Rendered a standalone SVG Cartesian graph card (`320×340px`) containing:
    - Main axes with tick marks from `-20` to `20` (y) and `-10` to `10` (x).
    - Grid lines.
    - Blue linear plot line.
    - Marked intercept points: `(0, 1)` and `x = -0.5`.
    - Caption: `y = 2x + 1 · x from -10 to 10`.
- **Evaluation**: **PASS**. Complete linear function plotting without external graphing widgets.

---

## 6. Detailed Defect & Collision Report

While functional contracts are exceptionally strong, interactive testing revealed **four layout collision issues** that impair usability on dense pages.

---

### Bug 1: Floating RegionMenu Overlaps Ink of Preceding Lines
- **Severity**: **HIGH** (Obscures student's writing area)
- **Likely Affected File**: `web/src/ui/Readback.tsx` (Line 136)
- **Reproduction Steps**:
  1. Write problem equation `2(x+3)=14` at y = 160.
  2. Write student working `2x+3=14` at y = 280 (120px below).
  3. Select the second line (`2x+3=14`).
- **Expected Behaviour**: The floating menu (`Ask`, `Read`, `Check`, etc.) should avoid existing ink regions, sitting in the left/right gutter with an anchor indicator, or position itself with dynamic collision avoidance.
- **Observed Behaviour**: The menu is positioned using a static vertical offset:
  `const y = s.y - 50 < 4 ? s.y + s.h + 36 : s.y - 50`
  At `s.y - 50`, the menu sits directly over the bottom half of the problem equation and its readback chip `2(x+3)=14`.
- **Evidence**: Confirmed in QA screenshot `live_hw_tutor_hint_wrong_step.png`.

---

### Bug 2: Step Completion Card (`write_equation`) Overlaps Readback Badge
- **Severity**: **HIGH** (Obscures validation status and edit controls)
- **Likely Affected File**: `web/src/tutor/layout.ts` (Lines 28–43)
- **Reproduction Steps**:
  1. Have an accepted line `2x + 6 = 14` with its readback badge (`2x + 6 = 14 Same solution as the problem Edit`) rendered beneath it at `s.y + s.h + 4`.
  2. Request `Next step`.
- **Expected Behaviour**: The completion card (`2x = 8`) should be positioned either in the right gutter or below both the ink **and** the readback badge (`dy >= 48`).
- **Observed Behaviour**: In `layout.ts`, candidate vertical offsets start at:
  `for (let dy = 16; dy <= 480; dy += 24) candidates.push({ x: anchor.x, y: anchor.y + anchor.h + dy, w, h })`
  Because `obstacles` only includes `page.strokes` and `page.tutorObjects` (ignoring the readback badge element), the candidate at `dy = 16` is accepted. The top of the `NOVA · next step` card lands directly over the readback text and `Edit` button.
- **Evidence**: Confirmed in QA screenshot `next_step_completion_1793435526287.png`.

---

### Bug 3: New Tutor Cards Collide and Stack Over Stale Tutor Cards
- **Severity**: **MEDIUM** (Visual clutter and overlapping text)
- **Likely Affected File**: `web/src/tutor/layout.ts` (Line 30)
- **Reproduction Steps**:
  1. Trigger a tutor hint for `2x + 3 = 14` (card placed at `anchor.x + anchor.w + 32`).
  2. Erase and correct the equation to `2x + 6 = 14`. The existing hint becomes stale (`Outdated`).
  3. Click `Check`.
- **Expected Behaviour**: Either the outdated card should be replaced/dismissed by the new check card for that anchor, or the new card should calculate the stale card as an obstacle and stack below/beside it.
- **Observed Behaviour**: `layout.ts` filters obstacles using:
  `...page.tutorObjects.filter((t) => t.status === 'active' && t.action.type !== 'highlight_region').map((t) => inflate(t.layout, 8))`
  Because the stale card has `status === 'stale'`, it is excluded from obstacles. The new card `This line keeps the same solution as the problem` is placed at the exact same coordinates, rendering directly on top of the stale card.
- **Evidence**: Confirmed in QA screenshot `successful_check_1793435504013.png`.

---

### Bug 4: Graph Plot Card Overlaps Active Selection Menu
- **Severity**: **MEDIUM** (Controls obscure plot header)
- **Likely Affected File**: `web/src/notebook/NotebookScreen.tsx` (Lines 226–237) & `web/src/tutor/layout.ts`
- **Reproduction Steps**:
  1. Write and confirm `y = 2x + 1`.
  2. Tap `Graph` in the region menu.
- **Expected Behaviour**: Invoking `Graph` should dismiss the active selection menu (`setSelected(null)`), or position the graph card clear of the floating toolbar.
- **Observed Behaviour**: The region menu remains open while the graph card is placed immediately below the anchor, causing the `Graph` and `Set as problem` buttons to overlap the top border and title of the graph card.
- **Evidence**: Confirmed in QA screenshot `graph_result_1793437751671.png`.

---

## 7. Untested Cases & Labelled Gaps

| Area | Status | Reason & Next Action |
|---|---|---|
| **Local Speech Engine (`/api/v1/transcribe`)** | **UNTESTED (NOT CONFIGURED)** | `faster-whisper` is uninstalled in accordance with policy (requires explicit download permission). Speech UI correctly shows graceful fallback text. Benchmark and install whisper when approved. |
| **Physical Stylus & Mobile Hardware Touch** | **UNTESTED (SIMULATED ONLY)** | Tested on desktop browser resized to mobile viewport (390×844). Hardware Apple Pencil / S-Pen palm rejection, tilt, and low-end mobile GPU canvas frame rates must be validated on an actual physical tablet. |
| **Multi-Megapixel Homework Image Import** | **UNTESTED** | File schema and asset storage verified in code, but importing a 10MB+ camera photo of physical paper was not run in this session. |
| **Extended Session Cap (60 Reads)** | **UNTESTED** | Session cap logic is implemented in `scheduler.ts`, but fewer than 20 live vision calls were performed during this session to conserve student token allowance. |

---

## 8. Prioritised Recommendation & Fix List

1. **Fix `layout.ts` Obstacle Inclusions (P0)**:
   - Add the region's readback height (36px) to the anchor obstacle so vertical candidates (`dy`) do not collide with readback badges.
   - Include `status === 'stale'` cards in layout collision obstacles, or auto-dismiss/retire stale notes when a superseding check/note arrives for the same anchor.
2. **Improve `RegionMenu` Collision Avoidance (P0)**:
   - In `Readback.tsx`, inspect bounding boxes of preceding lines. If vertical space above the region is less than 56px or overlaps another region, position the menu to the left/right gutter or below the readback badge.
3. **Dismiss Selection on Action Invocation (P1)**:
   - In `NotebookScreen.tsx`, when triggering `check`, `complete`, or `plot`, automatically clear selection (`setSelected(null)`) so the temporary floating menu does not persist over the newly generated card.
4. **Local Whisper Speech Engine Setup (P2)**:
   - Install `faster-whisper` and download `base.en` model after explicit user authorization, enabling full push-to-talk speech evaluation.
