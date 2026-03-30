# Overlay Rendering - Manual Test Checklist

## Maintaining settings presets and docs (do this on every `PipelineConfig` change)

When you add, remove, rename, or change the type/range of any field under **Processing** or **Caption and export** in the UI:

1. **[`src/renderer/src/lib/pipelineConfigPreset.ts`](src/renderer/src/lib/pipelineConfigPreset.ts)** — Update `DEFAULT_PIPELINE_CONFIG`, `mergePipelineConfigFromUnknown`, and bump `SPLITTY_PRESET_VERSION` if old JSON files must not load unchanged.
2. **[`engine/main.py`](engine/main.py)** — Extend `exportFull` sanitization and `render_full` arguments for any new engine behavior.
3. **[`src/main/ipcHandlers.ts`](src/main/ipcHandlers.ts)** — Clamp or validate new fields on the export IPC payload.
4. **[`OVERLAY-TEST-CHECKLIST.md`](OVERLAY-TEST-CHECKLIST.md)** — Add or adjust a row in the roadmap table, Test 7 sample JSON note if needed, and any new manual verification bullets.
5. Run **`npm test`**, **`python -m pytest engine/tests/`**, and **`npm run typecheck`**.

Sound-effect **slots** (files, triggers, volume) are not included in the JSON preset; only **pipeline** / **caption & export** options are.

---

## Test 1: Captions Only (No Graphics, No SFX)
1. Open Splitty AI (`npm run dev`)
2. Choose a video file with speech
3. Leave graphics sidebar empty, leave SFX slots empty (or all triggers Disabled)
4. Click "Process Video" — wait for pipeline to complete
5. Set "Max words" to 3 in the config panel (or load a preset JSON)
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
- [ ] Exported file contains `splittyPresetVersion: 1` and a `pipelineConfig` object with all current fields
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
| D | Face-driven zoom pulses (local OpenCV) | L | Shipped (optional flag) |
| E | Filler word stripping (text only) | S | Shipped |
| — | Multiple SFX per same trigger (round-robin) | M | Shipped |
| Preset | JSON import/export for `PipelineConfig` | S | Shipped |
| — | Timeline scrubber + export % progress | L | Backlog |
| — | Full graphic fade synced to main timeline | L | Backlog |

---

### Enhancement A1 — Source vs edited timeline times
**Goal:** Operators see when an event lands on the **source** file clock and on the **exported** (silence-cut) timeline.

**Implementation:** Engine `process` returns `keepSegments`; renderer maps `sourceTimeToOutput(start)`.

**Verification (implementation):** [x] Code path covered by integration with timeline UI.

**Manual verification (re-run after FFmpeg / silence algorithm changes):**
- [ ] Process a clip with removable silence; open Timeline Events.
- [ ] Each row shows **src** and **out** times; **out** matches export roughly for captions/graphics.

### Enhancement A2 — Caption styling
**Goal:** Large centered captions, custom color, optional background box (TikTok-style).

**Implementation:** Config panel + `exportFull` fields; `engine/render.py` `drawtext`.

**Verification (implementation):** [x]

**Manual verification:**
- [ ] Set position **Center**, size **48**, color **#FFE066**, export — text matches.
- [ ] Toggle **Caption background** — readability improves on busy footage.
- [ ] **Bold** uses a bold-capable font path (Windows: Segoe UI Bold when available).

### Enhancement A3 — Graphic position
**Goal:** Place graphics at center (default) or corners / top / bottom.

**Verification (implementation):** [x]

**Manual verification:**
- [ ] Set **Top right**, export — graphic sits in corner without clipping oddly at common resolutions.

### Enhancement B — Caption / graphic motion
**Goal:** Short fade on caption lines; slide-in for graphics when enabled.

**Verification (implementation):** [x]

**Manual verification:**
- [ ] Set caption fade in/out **0.15** s — no pop-in; timing still aligned with speech.
- [ ] Graphic **Slide in** — motion completes within the graphic window; no tearing.

### Enhancement C — SFX density and volume
**Goal:** Fewer (or more) caption/graphic SFX via **every N**; per-slot volume **0–200%**.

**Verification (implementation):** [x]

**Manual verification:**
- [ ] **Caption SFX every 2** — roughly half as many pop cues vs every 1.
- [ ] Lower one slot’s volume — that cue is quieter in the mix.

### Enhancement D — Face zoom (optional)
**Goal:** Periodic zoom toward detected face on **output** timeline (pulses), strength and interval configurable.

**Implementation:** `opencv-python-headless` + Haar cascade; optional; if OpenCV missing or no face, falls back to center crop.

**Verification (implementation):** [x]

**Manual verification:**
- [ ] Enable face zoom, export talking-head clip — subtle zoom pulses.
- [ ] Disable — identical to previous behavior.
- [ ] Profile / no face — no crash; neutral crop.

### Enhancement E — Filler words
**Goal:** Remove common fillers from **caption text** only (transcript words dropped before chunking).

**Verification (implementation):** [x]

**Manual verification:**
- [ ] Enable **Remove filler words**, export — “um” / “uh” absent from captions when Whisper separated them.
- [ ] Audio unchanged (filler may still be audible).

### Backlog (not implemented)
- [ ] Timeline scrubber in-app preview
- [ ] Export progress percentage
- [ ] Full graphic fade synced to main timeline (complex FFmpeg graph)
