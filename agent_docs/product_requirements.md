# Product Requirements

## Product Name & One-Line Description
- **Product:** Splitty AI
- **Description:** A $0-cost, fully local, open-source desktop app that automates short-form video pacing, captioning, and semantic graphic matching.

## Primary User Story (Source Text)
Tylor just finished recording a 60-second raw video talking about a new software architecture. Instead of spending two hours editing, he opens Splitty AI. He drags and drops his raw video file and a few diagrams he wants to show. He types a quick descriptive keyword for each diagram. Splitty AI processes the video locally, cuts the dead air, transcribes the audio, and perfectly times the diagrams to pop up exactly when he mentions them, complete with a quick animation and a "whoosh" sound effect. Five minutes later, the video is exported and ready for TikTok.

## Must-Have Features (Exact)
1. **Smart Ingestion & Silence Cutting**
2. **Local Transcription & Auto-Captioning**
3. **Semantic Graphic Matching**
4. **Automated Polish (Animations & SFX)**

## Nice-to-Have Features
- Not explicitly defined as "nice-to-have" in the PRD.
- Treat the following as post-MVP backlog from the PRD future table.

## NOT in MVP Features (Exact)
- **AI SFX Generation**
- **Multimodal Graphic Analysis (CLIP)**
- **AI Script/Prompt Generation**

## Success Metrics (All from PRD)
1. **Personal Brand Engagement**
   - Baseline vs. post-Splitty AI views/likes on published videos.
   - Measured using TikTok/Reels/Shorts native analytics.
2. **Local Processing Speed**
   - Time to render a 1-minute video.
   - Tracked via internal logging.

## UI/UX Requirements
- **Design words/vibe:** Simple, minimalist, developer-focused, dark mode by default.
- **Inspiration:** Clean desktop product feel (Cursor/Linear style).
- **Main workspace requirements:** drag/drop video, sidebar for graphic upload + tagging, process button, preview player.
- **Design principles:** function over flash, clear progress indicators for transcription/matching/rendering.

## Timeline & Constraints
- **Target launch:** 8-12 weeks (PRD)
- **Budget:** $0 total (tools, hosting, APIs)
- **Privacy:** 100% local; no data leaves device
- **Technical constraints:** Open-source commercially viable libraries only (MIT/Apache-like), quantized/efficient local models
- **Performance target:** <5x video length processing on standard hardware

## What This Project Will NOT Accept
- Cloud dependencies in core pipeline
- Black-box rendering with no user visibility/tweak path before final export
