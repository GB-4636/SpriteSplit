# SpriteSplit

**English** | [中文](README.zh-CN.md)

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
3. `./.venv/bin/python`
4. The Codex bundled runtime path when present
5. `python3.13`, `python3.12`, `python3.11`, `python3.10`, `python3`, `python`
6. `py -3`

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

## Use cases

### Game asset cleanup

You generated a sprite sheet with Midjourney, Stable Diffusion, or another image AI. The output is a single PNG with sprites arranged in roughly even rows and columns, but the exact pixel positions are irregular. SpriteSplit detects each sprite region from transparency, lets you visually confirm and adjust bounding boxes, and exports clean crops at uniform canvas size — ready for your game engine.

### Rapid asset cataloging

You have a large collection of existing sprite sheets that need structured metadata (names, descriptions, groups, tags). Import each sheet, let the alpha detector identify sprites, run AI Naming to auto-generate developer-friendly asset names and descriptions, then export JSON/CSV for your asset pipeline.

### Sprite sheet auditing

Before shipping or integrating assets, you need to verify that every sprite in a sheet has a valid bounding box, no overlaps, and proper naming. Use the visual editor to quickly scan, select, reorder, rename, and delete problem sprites — then export the corrected project file.

### AI art-to-game-asset pipeline

When prototyping a game with AI-generated art, you need a repeatable workflow: generate → detect → clean → export. SpriteSplit fills the "detect and clean" step with minimal manual effort, letting you focus on game development rather than pixel-level editing.

## How to use

### 1. Import a sprite sheet

Click **Import PNG** or drag-and-drop a transparent PNG onto the canvas. SpriteSplit will automatically run alpha-threshold detection and populate the sprite list.

### 2. Adjust detection settings

In the left panel under **Detection**:
- **Alpha threshold** — controls what pixel opacity counts as "content" (higher = fewer detected regions)
- **Minimum region area** — filters out tiny specks below a pixel threshold
- **Sort mode** — reorder sprites by row or column priority

Click **Re-run Detection** to apply updated settings.

### 3. Edit sprites visually

Use the canvas tools in the left panel:
- **Select** — click to select, Shift+click for multi-select
- **Create Box** — drag on the canvas to draw a new sprite region
- **Move** — drag selected sprites to reposition their bounding boxes
- **Resize** — drag corner handles to adjust box dimensions

In the sprite list:
- **Move Up / Move Down** — reorder sprites
- **Delete** — remove selected sprites

### 4. Name and describe sprites

Select a single sprite in the right panel's **Inspect** tab to manually edit name, group, tags, and description.

For batch naming, open the **AI** tab:
1. Enable the AI provider and fill in Base URL, API Key, and Model
2. Optionally paste the original generation prompt (used as naming context)
3. Click **Name All** or **Name Selected** to generate asset names and descriptions via AI

AI responses are cached by image hash + bbox + prompt, so re-running is fast.

### 5. Export

In the right panel's **Export** tab:
1. Choose an output directory
2. Toggle options: cropped PNGs, normalized canvas, JSON manifest, CSV summary
3. Click **Export Project**

## License

MIT. See [LICENSE](./LICENSE).
