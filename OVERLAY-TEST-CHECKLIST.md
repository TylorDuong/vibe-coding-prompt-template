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
- [ ] Export with no transcript segments (very short video)
- [ ] Export with graphics but no SFX
- [ ] Export with SFX but no graphics
- [ ] Export with all SFX triggers set to "Disabled"

---

## Future Enhancements (Post-Testing)
After the above tests pass, the next iteration should add:
- [ ] Timeline: show **source** and **edited** times for events (map graphics to final timeline by subtracting removed silence durations)
- [ ] Caption animations (fade in/out, pop, slide up)
- [ ] Graphic animations (slide in from side, scale up, fade)
- [ ] Caption styling options (font, size, color, position, background)
- [ ] Graphic positioning options (top-right, center, custom x/y)
- [ ] SFX volume control per slot
- [ ] Multiple SFX per trigger type
- [ ] Timeline scrubber for in-app preview before export
- [ ] Progress reporting during full export (percentage)
