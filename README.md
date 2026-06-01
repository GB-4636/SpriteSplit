# SpriteSplit

SpriteSplit is a desktop tool for cleaning up AI-generated sprite sheets that do not follow strict spacing or alignment. It detects independent non-transparent regions from PNG alpha, lets you correct and organize boxes visually, optionally enriches assets with AI-generated descriptions, and exports both structured metadata and cropped sprite images.

## What makes it different

- Built for irregular AI-generated sprite sheets, not just neatly packed atlases
- Detects sprite candidates from transparency using connected components
- Lets you export only metadata or metadata plus crops
- Stores the original image prompt for cataloging and AI naming context
- Supports manual correction with box creation, dragging, resizing, ordering, and naming
- Keeps AI description generation optional and provider-pluggable

## Stack

- `Tauri 2`
- `React + TypeScript + Vite`
- `Python + Pillow + NumPy`

## Current v1 scope

- PNG import through the desktop app
- Alpha-threshold detection of sprite regions
- Sort by row or column priority
- Visual editing of sprite boxes
- Undo and redo history
- JSON and CSV export
- Optional cropped PNG export
- Optional normalized canvas export
- OpenAI-compatible vision endpoint integration for descriptions

## Project structure

```text
src/                 React UI and editor logic
src-tauri/           Tauri shell and command bridge
python/              Python image analysis, export, and AI core
python_tests/        Python unit tests
```

## Requirements

- Node.js 20+
- Rust toolchain for Tauri builds
- Python 3.10+

The app resolves Python in this order:

1. `SPRITESPLIT_PYTHON`
2. `./.venv/Scripts/python.exe`
3. The Codex bundled runtime path when present
4. `python`
5. `py -3`

If Python is not on your machine, set `SPRITESPLIT_PYTHON` explicitly before launching `tauri dev`.

## Development

Install frontend dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run tauri:dev
```

Build the frontend only:

```bash
npm run build
```

Lint the frontend:

```bash
npm run lint
```

Run Python tests:

```bash
npm run test:python
```

## AI provider notes

The first version targets OpenAI-compatible chat-completions vision endpoints. You provide:

- Base URL
- API key
- Model
- Sheet prompt
- Sprite prompt

Descriptions are cached by source-image hash, bbox, prompt, and model settings to reduce repeated calls.

## Export outputs

Exports can include:

- `spritesplit-project.json`
- `spritesplit-sprites.csv`
- `crops/*.png`

Each sprite record contains:

- `id`
- `index`
- `bbox`
- `center`
- `area`
- `name`
- `description`
- `aiDescription`
- `tags`
- `group`
- `cropPath`

## License

MIT. See [LICENSE](./LICENSE).
