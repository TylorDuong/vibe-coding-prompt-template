# Overlay Rendering - Manual Test Checklist

## Test 1: Captions Only (No Graphics, No SFX)
1. Open Splitty AI (`npm run dev`)
2. Choose a video file with speech
3. Leave graphics sidebar empty, leave SFX slots empty
4. Click "Process Video" — wait for pipeline to complete
5. Set "Max words" to 3 in the config panel
6. Click "Full Export (Captions + Graphics + SFX)"
7. Save the output MP4

**Verify:**
- [ ] Captions appear at the bottom center of the video
- [ ] Only 3 words show at a time (matching "Max words" setting)
- [ ] Caption timing matches the spoken words
- [ ] Captions have white text with black border (readable)
- [ ] Silences are still correctly cut

## Test 2: Captions + Graphics
1. Process same video as Test 1
2. Add 1-2 images in the Graphics sidebar (Browse... button)
3. Tag each image with a keyword that relates to your speech
4. Click "Process Video" again
5. Verify the Timeline Events show "GRAPHIC" entries with similarity > 0
6. Click "Full Export"

**Verify:**
- [ ] Graphics appear overlaid on the video at the matched timestamps
- [ ] Graphics are centered and scaled to ~1/3 of video width
- [ ] Graphics disappear after their segment ends
- [ ] Captions still render correctly underneath

## Test 3: Captions + SFX
1. Process a video
2. Import a WAV/MP3 file into the "Swoosh SFX" slot
3. Set its trigger to "When graphic shows" or "When caption shows"
4. Click "Full Export"

**Verify:**
- [ ] SFX audio plays at the trigger timestamp
- [ ] SFX is mixed with the original audio (not replacing it)
- [ ] Volume levels are reasonable (SFX doesn't overpower speech)

## Test 4: Full Pipeline (Captions + Graphics + SFX)
1. Load video, add graphics with tags, import SFX files
2. Configure all triggers
3. Process and Full Export

**Verify:**
- [ ] All three overlay types render in the exported video
- [ ] Timing is correct across all elements
- [ ] Video plays without artifacts or corruption

## Test 5: Max Words Variation
1. Export same video with maxWords=1, then maxWords=5
2. Compare the two exports

**Verify:**
- [ ] maxWords=1 shows one word at a time (fast TikTok style)
- [ ] maxWords=5 shows longer phrases

## Test 6: Edge Cases
- [ ] Export with no transcript segments (very short video)
- [ ] Export with graphics but no SFX
- [ ] Export with SFX but no graphics
- [ ] Export with all SFX triggers set to "Disabled"

---

## Future Enhancements (Post-Testing)
After the above tests pass, the next iteration should add:
- [ ] Caption animations (fade in/out, pop, slide up)
- [ ] Graphic animations (slide in from side, scale up, fade)
- [ ] Caption styling options (font, size, color, position, background)
- [ ] Graphic positioning options (top-right, center, custom x/y)
- [ ] SFX volume control per slot
- [ ] Multiple SFX per trigger type
- [ ] Timeline scrubber for in-app preview before export
- [ ] Progress reporting during full export (percentage)
