# Splitty AI

Local-first desktop app that automates short-form video editing — silence cutting, captioning, semantic graphic matching, and polish effects — with zero cloud dependencies.

## Quick Start

### Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.10+ (with pip)
- **FFmpeg** on your PATH — required for silence detection, audio extraction, and full export (see below)

### FFmpeg

Install a full build that includes `ffmpeg` and `ffprobe`, then confirm the shell sees them (`ffmpeg -version`).

| OS | Suggested install |
|----|-------------------|
| Windows | `winget install Gyan.FFmpeg` (adds `%LOCALAPPDATA%\Microsoft\WinGet\Links` to PATH) |
| macOS | `brew install ffmpeg` |
| Linux | `apt install ffmpeg` / your distro equivalent |

**After installing or updating PATH**, open a **new** terminal and restart the dev app (`npm run dev`) so the Python engine inherits the updated environment.

**Windows export / captions:** Some FFmpeg builds log `Fontconfig error` and can crash during burn-in captions. The engine avoids that by using a system font under `%WINDIR%\Fonts` (e.g. Segoe UI, Arial). To force a specific font file, set:

`SPLITTY_FFMPEG_FONT=C:\path\to\YourFont.ttf`

then restart the app.

### Setup

```bash
# Install JS dependencies
npm install

# Install Python engine dependencies
pip install -r requirements.txt
```

### Development

```bash
npm run dev
```

Opens the Electron app with hot-reloading. The Python engine starts automatically.

### Usage

1. **Drop a video** (MP4, MOV, WebM, MKV, AVI) onto the workspace
2. **Add graphics** (optional): drag images into the sidebar and tag each with a keyword
3. **Adjust settings**: silence threshold (ms), attention length (ms)
4. **Click "Process Video"**: the pipeline runs 5 stages locally:
   - Validate → Detect silence → Transcribe → Match graphics → Build timeline
5. **Review the result**: visual timeline bar, color-coded events, collapsible details

### Testing

```bash
# Python engine tests
python -m pytest engine/tests/ -v

# Frontend build check
npm run build
```

## Architecture

```
├── src/main/          Electron main process (IPC + Python bridge)
├── src/preload/       Context bridge for renderer ↔ main
├── src/renderer/      React + Tailwind UI
├── engine/            Python processing pipeline
│   ├── main.py        JSON-over-stdin/stdout CLI
│   ├── video.py       FFmpeg: silence detection + cutting
│   ├── transcribe.py  faster-whisper: local ASR
│   ├── match.py       sentence-transformers: semantic matching
│   ├── polish.py      Timeline enrichment + SFX triggers
│   └── sfx/           Local sound effect assets
└── electron-builder.yml  Desktop packaging config
```

## Stack

| Layer | Technology |
|-------|-----------|
| UI | Electron + React + TypeScript + Tailwind CSS v4 |
| Build | electron-vite (Vite 7) |
| Media | FFmpeg 7+ (ffmpeg-python) |
| Transcription | faster-whisper (CTranslate2, CPU int8) |
| Matching | sentence-transformers (all-MiniLM-L6-v2) |
| Packaging | Electron Builder |

## Packaging

```bash
# Unpacked directory (fast, for testing)
npm run dist:dir

# Full installer
npm run dist
```

> Note: Code signing requires Windows Developer Mode. For unsigned builds, set `signAndEditExecutable: false` in `electron-builder.yml` (already configured).

## GPU Acceleration

The engine runs on CPU by default. To enable GPU:

1. Install PyTorch with CUDA: `pip install torch --index-url https://download.pytorch.org/whl/cu126`
2. Edit `engine/transcribe.py`: change `device="cpu"` to `device="cuda"` and `compute_type="int8"` to `compute_type="float16"`

## License

MIT
