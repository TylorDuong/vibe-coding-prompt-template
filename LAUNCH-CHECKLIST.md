# Launch Checklist

## Development Complete
- [x] Video ingestion and silence cutting works
- [x] Local Whisper transcription is functional
- [x] Semantic matching accurately places graphics
- [x] Animations and local SFX trigger correctly
- [x] Multi-stage progress indicators
- [x] Visual timeline bar with color-coded events
- [x] Configurable parameters with tooltips (silence dB, min silence, padding, merge gap, min keep, attention length)
- [x] Error handling: auto-restart, timeout, reconnect, actionable messages
- [x] Export button: cuts silences and saves MP4 via Save As dialog
- [x] Choose File button + native file dialogs (video + images)
- [x] Video thumbnail preview on import
- [x] Image preview thumbnails in graphics sidebar
- [x] 35 passing tests (unit + integration)

## Packaging
- [x] Electron Builder config (electron-builder.yml)
- [x] Engine files bundled in extraResources
- [x] Unpacked dir build produces working `Splitty AI.exe`
- [x] Custom app icon generated and placed in build/
- [ ] Enable Developer Mode for signed builds (optional, Windows setting)

## Security Pass
- [x] No secrets or credentials in committed files
- [x] No network calls in the processing pipeline (100% local)
- [x] Input validation on all IPC channels
- [x] File path validation in engine modules
- [x] Preload channel allowlist

## Pre-Launch Validation (User Confirmed)
- [x] Test with a real video recording
- [x] Verify transcription accuracy on real speech
- [x] Verify semantic matching with real graphics + tags
- [x] Confirm exported MP4 plays correctly in media player
- [x] Silence cutting correctly identifies pauses (not speech)
- [ ] Test on a second machine (verify all deps documented in README)

## First Usage Flow
1. Open Splitty AI (`npm run dev`)
2. Confirm "Engine connected" in green in status bar
3. Click "Choose File" or drag-drop a raw video
4. (Optional) Add graphics via sidebar "Browse..." button, tag each
5. Tune parameters: silence dB, min silence, padding, merge gap, min keep
6. Click "Process Video" — watch the 5-stage progress bar
7. Review timeline: silences, transcript, graphic matches, SFX events
8. Click "Export Video (Silence Cut)" — pick save location
9. Open exported MP4 in your media player

## Post-Launch
- [ ] Record and process first production video
- [ ] Compare engagement metrics (baseline vs Splitty AI)
- [ ] Log processing times for optimization targets
- [ ] Consider GPU acceleration for faster transcription
