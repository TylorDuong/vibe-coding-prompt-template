# Overlay Rendering - Manual Test Checklist

## Test 1: Captions Only (No Graphics, No SFX)
1. Open Splitty AI (`npm run dev`)
2. Choose a video file with speech
3. Leave graphics sidebar empty, leave SFX slots empty (or all triggers Disabled)
4. Click "Process Video" — wait for pipeline to complete
5. Set "Max words" to 3 in the config panel
6. Click **Export Video**
7. Save the output MP4

**Verify:**
- [x] Captions appear at the bottom center of the video
- [x] Only 3 words show at a time (matching "Max words" setting)
- [x] Caption timing matches the spoken words
- [x] Captions have white text with black border (readable)
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
- [x] Graphics appear overlaid on the video at the matched timestamps *(see log: times are still in **source** video time, not edited/final timeline after silence cuts — consider showing both on the timeline and subtracting cut lengths in the UI.)*
- [x] Graphics are centered; they disappear after their on-screen window ends; captions still render correctly
- [x] **Graphic width** (% of frame) matches setting with **aspect ratio preserved** *(engine: `scale2ref` width-first `w=if(gt(main_w×frac×ih/iw,main_h),…)` + `h=-2`, then `setsar=1` before `overlay`; re-verify after FFmpeg upgrades)*

## Test 3: Captions + SFX
1. Process a video
2. Import a WAV/MP3 into a SFX slot and set a trigger (e.g. When caption shows)
3. Click **Export Video**

**Verify:**
- [x] SFX audio plays only for slots you imported (no bundled placeholder sounds)
- [x] SFX is mixed with the original audio (not replacing it)
- [x] Volume levels are reasonable (SFX doesn't overpower speech)

## Test 4: Full Pipeline (Captions + Graphics + SFX)
1. Load video, add graphics with tags, import SFX files and configure triggers
2. Process and **Export Video**

**Verify:**
- [x] All three overlay types render in the exported video
- [x] Timing is consistent across overlays in the export; video plays without artifacts or corruption *(graphic times vs **final** edited timeline: see Test 2 log)*

## Test 5: Max Words Variation
1. Export same video with maxWords=1, then maxWords=5
2. Compare the two exports

**Verify:**
- [x] maxWords=1 shows one word at a time (fast TikTok style)
- [x] maxWords=5 shows longer phrases *(all max-words variations exercised)*

## Test 6: Edge Cases
- [X] Export with no transcript segments (very short video)
- [X] Export with graphics but no SFX
- [X] Export with SFX but no graphics
- [X] Export with all SFX triggers set to "Disabled"

---

## Future Enhancements (Post-Testing)
Implementation roadmap (ordered by dependency). Effort: **S** small, **M** medium, **L** large.

| Phase | Item | Effort | Notes |
|-------|------|--------|--------|
| A | Timeline: source + edited times | S | Uses `keepSegments` from engine; UI shows both |
| A | Caption styling (size, color, position, bold, box) | M | FFmpeg `drawtext`; bold via font file (`SPLITTY_FFMPEG_FONT` / system bold TTF) |
| A | Graphic position presets | S | Overlay `x`/`y` presets (center, corners, top/bottom) |
| B | Caption intro/outro (fade) | M | `drawtext` `alpha` expression |
| B | Graphic intro motion (e.g. slide-in) | M | Animated overlay `x`/`y`; full graphic fade is harder in single-pass FFmpeg |
| C | SFX frequency (every Nth caption/graphic) | S | Throttle in `collect_sfx_plays` |
| C | SFX volume per slot | M | `volume` filter per branch before `amix` |
| C | Attention length vs SFX density | S | Existing **Attention length** ms — higher ⇒ fewer attention-fill cues |
| D | Face-driven zoom pulses (local OpenCV) | L | Optional; gated flag; samples video for face center |
| E | Filler word stripping (text only) | S | Blocklist on word list before caption chunking; does not cut audio |
| — | Multiple SFX per same trigger (round-robin) | M | `sfxAssignments` array |
| — | Timeline scrubber + export % progress | L | Not started |

---

### Enhancement A1 — Source vs edited timeline times
**Goal:** Operators see when an event lands on the **source** file clock and on the **exported** (silence-cut) timeline.

**Implementation:** Engine `process` returns `keepSegments`; renderer maps `sourceTimeToOutput(start)`.

**Manual verification:**
- [ ] Process a clip with removable silence; open Timeline Events.
- [ ] Each row shows **src** and **out** times; **out** matches export roughly for captions/graphics.

### Enhancement A2 — Caption styling
**Goal:** Large centered captions, custom color, optional background box (TikTok-style).

**Implementation:** Config panel + `exportFull` fields; `engine/render.py` `drawtext`.

**Manual verification:**
- [ ] Set position **Center**, size **48**, color **#FFE066**, export — text matches.
- [ ] Toggle **Caption background** — readability improves on busy footage.
- [ ] **Bold** uses a bold-capable font path (Windows: Segoe UI Bold when available).

### Enhancement A3 — Graphic position
**Goal:** Place graphics at center (default) or corners / top / bottom.

**Manual verification:**
- [ ] Set **Top right**, export — graphic sits in corner without clipping oddly at common resolutions.

### Enhancement B — Caption / graphic motion
**Goal:** Short fade on caption lines; slide-in for graphics when enabled.

**Manual verification:**
- [ ] Set caption fade in/out **0.15** s — no pop-in; timing still aligned with speech.
- [ ] Graphic **Slide in** — motion completes within the graphic window; no tearing.

### Enhancement C — SFX density and volume
**Goal:** Fewer (or more) caption/graphic SFX via **every N**; per-slot volume **0–200%**.

**Manual verification:**
- [ ] **Caption SFX every 2** — roughly half as many pop cues vs every 1.
- [ ] Lower one slot’s volume — that cue is quieter in the mix.

### Enhancement D — Face zoom (optional)
**Goal:** Periodic zoom toward detected face on **output** timeline (pulses), strength and interval configurable.

**Implementation:** `opencv-python-headless` + Haar cascade; optional; if OpenCV missing or no face, falls back to center crop.

**Manual verification:**
- [ ] Enable face zoom, export talking-head clip — subtle zoom pulses.
- [ ] Disable — identical to previous behavior.
- [ ] Profile / no face — no crash; neutral crop.

### Enhancement E — Filler words
**Goal:** Remove common fillers from **caption text** only (transcript words dropped before chunking).

**Manual verification:**
- [ ] Enable **Remove filler words**, export — “um” / “uh” absent from captions when Whisper separated them.
- [ ] Audio unchanged (filler may still be audible).

### Backlog (not implemented here)
- [ ] Timeline scrubber in-app preview
- [ ] Export progress percentage
- [ ] Full graphic fade synced to main timeline (complex FFmpeg graph)
