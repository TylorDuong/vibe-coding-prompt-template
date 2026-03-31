# Overlay Rendering - Manual Test Checklist

## Maintaining settings presets and docs (do this on every `PipelineConfig` change)

When you add, remove, rename, or change the type/range of any field under **Silence removal**, **Processing parameters** (export ratio/speed), **Caption and export**, or **Graphics sidebar** (graphic settings in preset JSON) in the UI:

1. **[`src/renderer/src/lib/pipelineConfigPreset.ts`](src/renderer/src/lib/pipelineConfigPreset.ts)** — Update `DEFAULT_PIPELINE_CONFIG`, `mergePipelineConfigFromUnknown`, and bump `SPLITTY_PRESET_VERSION` only if old JSON files must not load unchanged.
2. **[`engine/main.py`](engine/main.py)** — Extend `exportFull` sanitization and `render_full` arguments for any new engine behavior.
3. **[`src/main/ipcHandlers.ts`](src/main/ipcHandlers.ts)** — Clamp or validate new fields on the export IPC payload.
4. **[`OVERLAY-TEST-CHECKLIST.md`](OVERLAY-TEST-CHECKLIST.md)** — Add or adjust a row in the roadmap table, Test 7 sample JSON note if needed, and any new manual verification bullets.
5. Run **`npm test`**, **`python -m pytest engine/tests/`**, and **`npm run typecheck`**.

Sound-effect **slots** (files, triggers, volume) are not included in the JSON preset; only **pipeline** / **caption & export** options are.

**Removed from presets:** `removeFillerWords` (feature dropped). Unknown keys in imported JSON are ignored.

**New preset keys:** `graphicFadeInSec`, `graphicFadeOutSec` (seconds; 0 = off); `captionOutlineColor` (`#RRGGBB`); `outputAspectRatio` (`original` \| `16:9` \| `9:16` \| `1:1` \| `4:5`); `videoSpeed` (0.25–4, default 1).

---

## Test 1: Captions Only (No Graphics, No SFX)
1. Open Splitty AI (`npm run dev`)
2. Choose a video file with speech
3. Leave graphics sidebar empty, leave SFX slots empty (or all triggers Disabled)
4. Click "Process Video" — wait for pipeline to complete
5. Set **Max words per caption** to 3 in **Caption and export** (or load a preset JSON)
6. Click **Export Video**
7. Save the output MP4

**Verify:**
- [x] Captions appear at the bottom center of the video (unless you set **Caption position** to Center / changed size/color)
- [x] Only 3 words show at a time (matching "Max words" setting)
- [x] Caption timing matches the spoken words
- [x] Captions have readable contrast (default: white text with outline; optional background box)
- [x] Silences are still correctly cut

## Test 2: Captions + Graphics
1. Process same video as Test 1
2. Add 1-2 images in the Graphics sidebar (Browse... button)
3. Tag each image with a keyword that relates to your speech
4. Click "Process Video" again
5. Verify the Timeline Events show "GRAPHIC" entries with similarity > 0
6. Adjust **Graphic width** (% of frame width, default 85%) and **Graphic length** (on-screen seconds) as needed
7. Click **Export Video**

**Verify:**
- [x] Graphics appear overlaid on the video at the matched timestamps
- [x] Timeline Events list shows **src** and **out** times per event (after silence cuts)
- [x] Graphics respect **Graphic position** / **Graphic motion**; captions still render correctly
- [x] **Graphic width** (% of frame) matches setting with **aspect ratio preserved** *(engine: `scale2ref` width-first; re-verify after FFmpeg upgrades)*

## Test 3: Captions + SFX
1. Process a video
2. Import a WAV/MP3 into a SFX slot and set a trigger (e.g. When caption shows)
3. Click **Export Video**

**Verify:**
- [x] SFX audio plays only for slots you imported (no bundled placeholder sounds)
- [x] SFX is mixed with the original audio (not replacing it)
- [x] Volume levels are reasonable (SFX doesn't overpower speech); per-slot **Vol %** affects gain

## Test 4: Full Pipeline (Captions + Graphics + SFX)
1. Load video, add graphics with tags, import SFX files and configure triggers
2. Process and **Export Video**

**Verify:**
- [x] All three overlay types render in the exported video
- [x] Timing is consistent across overlays in the export; video plays without artifacts or corruption

## Test 5: Max Words Variation
1. Export same video with maxWords=1, then maxWords=5
2. Compare the two exports

**Verify:**
- [x] maxWords=1 shows one word at a time (fast TikTok style)
- [x] maxWords=5 shows longer phrases *(all max-words variations exercised)*

## Test 6: Edge Cases
- [x] Export with no transcript segments (very short video)
- [x] Export with graphics but no SFX
- [x] Export with SFX but no graphics
- [x] Export with all SFX triggers set to "Disabled"

## Test 7: Settings preset (JSON import / export)
1. Tune several options (e.g. caption center, larger font, caption fades, SFX every N)
2. Click **Export JSON…** and save `splitty-settings.json`
3. Reset fields manually or restart the app; click **Import JSON…** and pick the same file

**Verify:**
- [ ] Exported file contains `splittyPresetVersion: 1` and a `pipelineConfig` object with all current fields (including `graphicFadeInSec` / `graphicFadeOutSec`, `captionOutlineColor`, `outputAspectRatio`, `videoSpeed` when present)
- [ ] After import, UI values match the saved preset
- [ ] Processing and export behave consistently with the restored settings

---

## Future Enhancements (Post-Testing)

Implementation roadmap. **Status:** Shipped = in codebase; **Backlog** = not started.

| Phase | Item | Effort | Status |
|-------|------|--------|--------|
| A | Timeline: source + edited times | S | Shipped |
| A | Caption styling (size, color, position, bold, box) | M | Shipped |
| A | Graphic position presets | S | Shipped |
| B | Caption intro/outro (fade) | M | Shipped |
| B | Graphic intro motion (e.g. slide-in) | M | Shipped |
| C | SFX frequency (every Nth caption/graphic) | S | Shipped |
| C | SFX volume per slot | M | Shipped |
| C | Attention length vs SFX density | S | Shipped (existing control) |
| D | Face-driven zoom pulses (local OpenCV) | L | Shipped (optional flag; export uses `zoompan` + `in_time`) |
| UI | Caption live preview in config | S | Shipped |
| UI | Workspace layout: transcript + graphics column in Pipeline Result; export below | M | Shipped |
| Export | Output aspect ratio (center crop) + video speed (×) | M | Shipped |
| UI | Silence removal vs processing vs caption sections | S | Shipped |
| UI | Timeline: caption span row + graphic duration bars | S | Shipped |
| — | Multiple SFX per same trigger (round-robin) | M | Shipped |
| Preset | JSON import/export for `PipelineConfig` | S | Shipped |
| — | Timeline scrubber + optional `local-file://` video preview | M | Shipped |
| — | Export progress percentage (FFmpeg stderr → stdout → IPC) | M | Shipped |
| — | Full graphic fade synced to main timeline (`fade` + `setpts` on overlay) | M | Shipped |
| E | Filler word stripping (text only) | — | **Removed** |

---

### Enhancement A1 — Source vs edited timeline times
**Goal:** Operators see when an event lands on the **source** file clock and on the **exported** (silence-cut) timeline.

**Implementation:** Engine `process` returns `keepSegments`; renderer maps `sourceTimeToOutput(start)`.

**Verification (implementation):** [x] Code path covered by integration with timeline UI.

**Manual verification (re-run after FFmpeg / silence algorithm changes):**
- [X] Process a clip with removable silence; open Timeline Events.
- [X] Each row shows **src** and **out** times; **out** matches export roughly for captions/graphics.

### Enhancement A2 — Caption styling
**Goal:** Large centered captions, custom color, optional background box (TikTok-style).

**Implementation:** Config panel + `exportFull` fields; `engine/render.py` `drawtext`.

**Verification (implementation):** [x]

**Manual verification:**
- [X] Set position **Center**, size **48**, color **#FFE066**, export — text matches.
- [X] Toggle **Caption background** — readability improves on busy footage.
- [X] **Bold** uses a bold-capable font path (Windows: Segoe UI Bold when available).

### Enhancement UI — Caption preview
**Goal:** See approximate caption size, color, bold, box, outline color, and bottom vs center on white / grey / black backgrounds before export.

**Manual verification:**
- [ ] Change caption settings — triple preview updates; **Bottom** vs **Center** is obvious; outline color matches.

### Enhancement UI — Workspace layout
**Goal:** After process, transcript and graphics (with graphic settings) sit side-by-side inside Pipeline Result; summary/timeline/video/events stay full width above; **Export Video** remains below.

**Manual verification:**
- [ ] After process: transcript left, graphics column right in the lower section; **Export Video** is under the card.

### Enhancement A3 — Graphic position
**Goal:** Place graphics at center (default) or corners / top / bottom.

**Verification (implementation):** [x]

**Manual verification:**
- [X] Set **Top right**, export — graphic sits in corner without clipping oddly at common resolutions.

### Enhancement B — Caption / graphic motion
**Goal:** Short fade on caption lines; slide-in for graphics when enabled.

**Verification (implementation):** [x]

**Manual verification:**
- [X] Set caption fade in/out **0.15** s — no pop-in; timing still aligned with speech.
- [X] Graphic **Slide in** — motion completes within the graphic window; no tearing.

### Enhancement C — SFX density and volume
**Goal:** Fewer (or more) caption/graphic SFX via **every N**; per-slot volume **0–200%**.

**Verification (implementation):** [x]

**Manual verification:**
- [ ] **Caption SFX every 2** — roughly half as many pop cues vs every 1.
- [ ] Lower one slot’s volume — that cue is quieter in the mix.

### Enhancement D — Face zoom (optional)
**Goal:** Periodic zoom toward detected face on **output** timeline (pulses), strength and interval configurable.

**Implementation:** `opencv-python-headless` + Haar cascade; optional; if OpenCV missing or no face, falls back to center crop. Filter stage uses **`zoompan`** with **`in_time`** in the active expression (avoids broken dynamic `crop`).

**Verification (implementation):** [x] `engine/tests/test_render.py` asserts `zoompan` in filter graph when enabled.

**Manual verification:**
- [ ] Enable face zoom, export talking-head clip — subtle zoom pulses visible.
- [ ] Disable — no zoom pulses.
- [ ] Profile / no face — no crash; neutral crop.

### Enhancement — Timeline scrubber + preview
**Goal:** Drag/click playhead on the bar; optional `<video>` seeks via `local-file://` (main process resolves Windows paths).

**Manual verification:**
- [ ] Drag playhead — time label updates; video frame follows (if preview visible).
- [ ] Caption row shows blue spans; main row shows green graphic spans and red silence regions.

### Enhancement — Export progress
**Goal:** Linear 0–100% while FFmpeg runs.

**Manual verification:**
- [ ] Long export — percent advances; completes at 100%.

### Enhancement — Graphic fade (alpha)
**Goal:** Fade graphics in/out on the main export timeline (`graphicFadeInSec` / `graphicFadeOutSec`).

**Verification (implementation):** [x] `engine/tests/test_render.py` asserts `fade=t=in` and `format=rgba` when fades > 0.

**Manual verification:**
- [ ] Set **Gfx fade in/out** to ~0.25s, export with a matched graphic — soft edges at start/end.
