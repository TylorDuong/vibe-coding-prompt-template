# Launch Checklist

## Development Complete
- [x] Video ingestion and silence cutting works
- [x] Local Whisper transcription is functional
- [x] Semantic matching accurately places graphics
- [x] Animations and local SFX trigger correctly
- [x] Multi-stage progress indicators
- [x] Visual timeline bar with color-coded events
- [x] Configurable silence threshold and attention length
- [x] Error handling: auto-restart, timeout, reconnect, actionable messages
- [x] 30 passing tests (unit + integration)

## Packaging
- [x] Electron Builder config (electron-builder.yml)
- [x] Engine files bundled in extraResources
- [x] Unpacked dir build produces working `Splitty AI.exe`
- [ ] Enable Developer Mode for signed builds (optional)
- [ ] Custom app icon (replace default Electron icon)

## Pre-Launch Validation
- [ ] Test with a real 60-second video recording (not synthetic)
- [ ] Verify transcription accuracy on real speech
- [ ] Verify semantic matching with real graphics + tags
- [ ] Confirm exported timeline data is correct
- [ ] Test on a second machine (verify all deps documented)

## Security Pass
- [ ] No secrets or credentials in committed files
- [ ] No network calls in the processing pipeline (100% local)
- [ ] Input validation on all IPC channels
- [ ] File path validation in engine modules

## First Usage Flow
1. Open Splitty AI
2. Confirm "Engine connected" in status bar
3. Drop a raw video file
4. (Optional) Drop diagrams/graphics in sidebar, tag each
5. Click "Process Video"
6. Review timeline: silences, transcript, graphic matches, SFX
7. Iterate: adjust threshold/attention, re-process

## Post-Launch
- [ ] Record and process first production video
- [ ] Compare engagement metrics (baseline vs Splitty AI)
- [ ] Log processing times for optimization targets
- [ ] Consider GPU acceleration for faster transcription
