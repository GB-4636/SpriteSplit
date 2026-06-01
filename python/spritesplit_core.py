from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Expected a subcommand.")

    payload = json.loads(sys.stdin.read() or "{}")
    subcommand = sys.argv[1]

    if subcommand == "analyze-image":
        result = analyze_image(payload)
    elif subcommand == "generate-descriptions":
        result = generate_descriptions(payload)
    elif subcommand == "export-project":
        result = export_project(payload)
    else:
        raise SystemExit(f"Unknown subcommand: {subcommand}")

    sys.stdout.write(json.dumps(result, ensure_ascii=False))


def analyze_image(payload: dict[str, Any]) -> dict[str, Any]:
    image_path = Path(payload["imagePath"])
    settings = payload.get("settings", {})
    alpha_threshold = int(settings.get("alphaThreshold", 10))
    min_area = int(settings.get("minArea", 16))
    sort_mode = settings.get("sortMode", "top-to-bottom-left-to-right")

    image = Image.open(image_path).convert("RGBA")
    alpha = np.array(image.getchannel("A"))
    mask = alpha > alpha_threshold

    components = detect_components(mask, min_area)
    components = sort_components(components, sort_mode)

    warnings: list[str] = []
    if not components:
        warnings.append("No non-transparent regions were found with the current threshold.")

    sprites: list[dict[str, Any]] = []
    for index, component in enumerate(components, start=1):
        bbox = component.bbox
        width = bbox["width"]
        height = bbox["height"]
        sprites.append(
            {
                "id": f"sprite-{index:03d}",
                "index": index,
                "bbox": bbox,
                "center": {
                    "x": round(bbox["x"] + width / 2, 2),
                    "y": round(bbox["y"] + height / 2, 2),
                },
                "area": component.area,
                "name": f"sprite_{index:03d}",
                "description": "",
                "aiDescription": "",
                "tags": [],
                "group": "",
                "cropPath": "",
            }
        )

    return {
        "sourceImagePath": str(image_path),
        "sourceImageName": image_path.name,
        "imageSize": {"width": image.width, "height": image.height},
        "detectionSettings": {
            "alphaThreshold": alpha_threshold,
            "minArea": min_area,
            "sortMode": sort_mode,
        },
        "prompt": payload.get("prompt", ""),
        "sheetContext": "",
        "sprites": sprites,
        "warnings": warnings,
    }


@dataclass
class Component:
    bbox: dict[str, int]
    area: int


def detect_components(mask: np.ndarray, min_area: int) -> list[Component]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    components: list[Component] = []

    for y in range(height):
        for x in range(width):
            if not mask[y, x] or visited[y, x]:
                continue

            stack = [(x, y)]
            visited[y, x] = True
            min_x = max_x = x
            min_y = max_y = y
            area = 0

            while stack:
                current_x, current_y = stack.pop()
                area += 1
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)

                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and mask[next_y, next_x]
                        and not visited[next_y, next_x]
                    ):
                        visited[next_y, next_x] = True
                        stack.append((next_x, next_y))

            if area < min_area:
                continue

            components.append(
                Component(
                    bbox={
                        "x": int(min_x),
                        "y": int(min_y),
                        "width": int(max_x - min_x + 1),
                        "height": int(max_y - min_y + 1),
                    },
                    area=int(area),
                )
            )

    return components


def sort_components(components: list[Component], sort_mode: str) -> list[Component]:
    if sort_mode == "left-to-right-top-to-bottom":
        return sorted(components, key=lambda component: (component.bbox["x"], component.bbox["y"]))
    return sorted(components, key=lambda component: (component.bbox["y"], component.bbox["x"]))


def generate_descriptions(payload: dict[str, Any]) -> dict[str, Any]:
    project = deepcopy(payload["project"])
    provider_config = payload.get("providerConfig", {})
    warnings = list(project.get("warnings", []))

    if not provider_config.get("enabled"):
        warnings.append("AI descriptions skipped because the provider is disabled.")
        project["warnings"] = dedupe_warnings(warnings)
        return project

    if not all(provider_config.get(field) for field in ("baseUrl", "apiKey", "model")):
        warnings.append("AI descriptions skipped because provider settings are incomplete.")
        project["warnings"] = dedupe_warnings(warnings)
        return project

    source_image_path = Path(project["sourceImagePath"])
    prompt = project.get("prompt", "")
    sprites = project.get("sprites", [])
    selected_ids = set(provider_config.get("spriteIds", []))
    sprite_targets = [sprite for sprite in sprites if not selected_ids or sprite["id"] in selected_ids]

    try:
        image = Image.open(source_image_path).convert("RGBA")
    except FileNotFoundError:
        warnings.append(f"Source image not found for AI description: {source_image_path}")
        project["warnings"] = dedupe_warnings(warnings)
        return project

    provider = OpenAICompatibleProvider(provider_config)

    try:
        sheet_context = read_or_generate_cache(
            build_cache_key(
                "sheet",
                source_image_path,
                provider_config,
                prompt=prompt,
            ),
            lambda: provider.describe_sheet_context(image, prompt, len(sprites)),
        )
        project["sheetContext"] = sheet_context
    except Exception as error:  # noqa: BLE001
        warnings.append(f"Sheet context generation failed: {error}")
        project["warnings"] = dedupe_warnings(warnings)
        return project

    target_ids = {sprite["id"] for sprite in sprite_targets}
    used_names = {
        sanitize_asset_name(sprite.get("name", ""))
        for sprite in sprites
        if sprite.get("id") not in target_ids and sprite.get("name")
    }

    for sprite in sprite_targets:
        try:
            metadata = read_or_generate_json_cache(
                build_cache_key(
                    "sprite-metadata-v2",
                    source_image_path,
                    provider_config,
                    bbox=sprite["bbox"],
                    prompt=prompt,
                    sheet_context=project.get("sheetContext", ""),
                ),
                lambda sprite=sprite: provider.describe_sprite_metadata(
                    image=image,
                    bbox=sprite["bbox"],
                    prompt=prompt,
                    sheet_context=project.get("sheetContext", ""),
                    suggested_name=sprite.get("name", ""),
                ),
            )
            ai_name = unique_asset_name(
                sanitize_asset_name(str(metadata.get("name") or sprite.get("name") or "sprite")),
                used_names,
            )
            used_names.add(ai_name)
            description = str(metadata.get("description") or "").strip()
            if not description:
                description = str(metadata.get("summary") or metadata.get("aiDescription") or "").strip()

            sprite["name"] = ai_name
            sprite["aiDescription"] = description
            if not sprite.get("description"):
                sprite["description"] = description
        except Exception as error:  # noqa: BLE001
            warnings.append(f"Sprite {sprite.get('id', '?')} description failed: {error}")

    project["warnings"] = dedupe_warnings(warnings)
    return project


class OpenAICompatibleProvider:
    def __init__(self, provider_config: dict[str, Any]) -> None:
        self.base_url = provider_config["baseUrl"].rstrip("/")
        self.api_key = provider_config["apiKey"]
        self.model = provider_config["model"]
        self.timeout_seconds = int(provider_config.get("timeoutSeconds", 60) or 60)
        self.sheet_prompt = provider_config.get(
            "sheetPrompt",
            "Summarize this sprite sheet in one short paragraph for asset management. "
            "Focus on style, subject matter, and any repeated visual themes.",
        )
        self.sprite_prompt = provider_config.get(
            "spritePrompt",
            "Describe this sprite briefly for naming and cataloging. Return one concise sentence.",
        )

    def describe_sheet_context(self, image: Image.Image, prompt: str, sprite_count: int) -> str:
        text_prompt = (
            f"{self.sheet_prompt}\n"
            f"Original generation prompt: {prompt or 'N/A'}\n"
            f"Detected sprite count: {sprite_count}"
        )
        return self._chat_with_image(image_to_data_uri(image), text_prompt)

    def describe_sprite_metadata(
        self,
        image: Image.Image,
        bbox: dict[str, int],
        prompt: str,
        sheet_context: str,
        suggested_name: str,
    ) -> dict[str, str]:
        cropped = crop_image(image, bbox)
        text_prompt = (
            f"{self.sprite_prompt}\n"
            "Return JSON only with this schema: "
            '{"name":"short_snake_case_asset_name","description":"one concise visual description"}.\n'
            "The name is the primary output. It must be specific, developer-friendly, "
            "lowercase snake_case, 2 to 5 words, and contain only a-z, 0-9, and underscores. "
            "Do not include file extensions, indexes, generic words like sprite/image/icon unless necessary, "
            "or surrounding markdown.\n"
            f"Original generation prompt: {prompt or 'N/A'}\n"
            f"Sheet context: {sheet_context or 'N/A'}\n"
            f"Current suggested name: {suggested_name or 'N/A'}"
        )
        response = self._chat_with_image(image_to_data_uri(cropped), text_prompt)
        metadata = parse_sprite_metadata_response(response)
        metadata["name"] = sanitize_asset_name(metadata.get("name") or suggested_name or "sprite")
        metadata["description"] = str(metadata.get("description") or response).strip()
        return metadata

    def _chat_with_image(self, image_data_uri: str, text_prompt: str) -> str:
        url = self._chat_completions_url()
        payload = {
            "model": self.model,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": text_prompt},
                        {"type": "image_url", "image_url": {"url": image_data_uri}},
                    ],
                }
            ],
        }
        request = urllib.request.Request(
            url=url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            debug_log(f"AI request start url={redact_url(url)} model={self.model} timeout={self.timeout_seconds}s")
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
            debug_log(f"AI request complete url={redact_url(url)}")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="ignore")
            debug_log(f"AI request HTTP {error.code} url={redact_url(url)} body={truncate_log(body)}")
            raise RuntimeError(body) from error
        except Exception as error:
            debug_log(f"AI request failed url={redact_url(url)} error={error}")
            raise

        message = data["choices"][0]["message"]["content"]
        if isinstance(message, list):
            text_parts = [
                item.get("text", "")
                for item in message
                if isinstance(item, dict) and item.get("type") == "text"
            ]
            return " ".join(part.strip() for part in text_parts if part.strip())
        return str(message).strip()

    def _chat_completions_url(self) -> str:
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return f"{self.base_url}/chat/completions"


def debug_log(message: str) -> None:
    log_path = os.environ.get("SPRITESPLIT_PYTHON_LOG")
    if not log_path:
        return
    timestamp = datetime.now().isoformat(timespec="seconds")
    try:
        with Path(log_path).open("a", encoding="utf-8") as log_file:
            log_file.write(f"{timestamp} {message}\n")
    except OSError:
        pass


def redact_url(url: str) -> str:
    return re.sub(r"([?&](?:api[_-]?key|key|token)=)[^&]+", r"\1<redacted>", url, flags=re.I)


def truncate_log(value: str, limit: int = 1200) -> str:
    value = value.strip()
    if len(value) <= limit:
        return value
    return f"{value[:limit]}...<truncated>"


def export_project(payload: dict[str, Any]) -> dict[str, Any]:
    project = deepcopy(payload["project"])
    export_settings = payload.get("exportSettings", {})
    output_dir = Path(export_settings["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    source_image = Image.open(project["sourceImagePath"]).convert("RGBA")
    sprites = project.get("sprites", [])

    export_crops = bool(export_settings.get("exportCrops", False))
    normalize_canvas = bool(export_settings.get("normalizeCanvas", False))
    include_json = bool(export_settings.get("includeJson", True))
    include_csv = bool(export_settings.get("includeCsv", True))

    canvas_width = int(export_settings.get("canvasWidth", 0) or 0)
    canvas_height = int(export_settings.get("canvasHeight", 0) or 0)

    if normalize_canvas and (canvas_width <= 0 or canvas_height <= 0):
        canvas_width = max((sprite["bbox"]["width"] for sprite in sprites), default=0)
        canvas_height = max((sprite["bbox"]["height"] for sprite in sprites), default=0)

    crop_dir = output_dir / "crops"
    if export_crops:
        crop_dir.mkdir(parents=True, exist_ok=True)

    exported_sprites: list[str] = []
    for sprite in sprites:
        sprite["cropPath"] = ""
        if not export_crops:
            continue

        cropped = crop_image(source_image, sprite["bbox"])
        if normalize_canvas:
            cropped = center_on_canvas(cropped, canvas_width, canvas_height)

        file_stem = sanitize_filename(sprite.get("name") or f"sprite_{sprite['index']:03d}")
        file_name = f"{sprite['index']:03d}_{file_stem}.png"
        destination = crop_dir / file_name
        cropped.save(destination)
        sprite["cropPath"] = str(destination)
        exported_sprites.append(str(destination))

    project["exportSettings"] = {
        "outputDir": str(output_dir),
        "exportCrops": export_crops,
        "normalizeCanvas": normalize_canvas,
        "canvasWidth": canvas_width,
        "canvasHeight": canvas_height,
        "includeJson": include_json,
        "includeCsv": include_csv,
    }

    manifest_path = output_dir / "spritesplit-project.json"
    csv_path = output_dir / "spritesplit-sprites.csv"

    if include_json:
        manifest_path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")

    if include_csv:
        with csv_path.open("w", encoding="utf-8-sig", newline="") as csv_file:
            writer = csv.DictWriter(
                csv_file,
                fieldnames=[
                    "index",
                    "id",
                    "name",
                    "group",
                    "tags",
                    "description",
                    "aiDescription",
                    "x",
                    "y",
                    "width",
                    "height",
                    "centerX",
                    "centerY",
                    "area",
                    "cropPath",
                ],
            )
            writer.writeheader()
            for sprite in sprites:
                writer.writerow(
                    {
                        "index": sprite["index"],
                        "id": sprite["id"],
                        "name": sprite.get("name", ""),
                        "group": sprite.get("group", ""),
                        "tags": ", ".join(sprite.get("tags", [])),
                        "description": sprite.get("description", ""),
                        "aiDescription": sprite.get("aiDescription", ""),
                        "x": sprite["bbox"]["x"],
                        "y": sprite["bbox"]["y"],
                        "width": sprite["bbox"]["width"],
                        "height": sprite["bbox"]["height"],
                        "centerX": sprite["center"]["x"],
                        "centerY": sprite["center"]["y"],
                        "area": sprite.get("area", 0),
                        "cropPath": sprite.get("cropPath", ""),
                    }
                )

    return {
        "project": project,
        "manifestPath": str(manifest_path) if include_json else "",
        "csvPath": str(csv_path) if include_csv else "",
        "cropDirectory": str(crop_dir) if export_crops else "",
        "exportedSprites": exported_sprites,
    }


def crop_image(image: Image.Image, bbox: dict[str, int]) -> Image.Image:
    left = int(bbox["x"])
    top = int(bbox["y"])
    right = left + int(bbox["width"])
    bottom = top + int(bbox["height"])
    return image.crop((left, top, right, bottom))


def center_on_canvas(image: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    offset_x = max((width - image.width) // 2, 0)
    offset_y = max((height - image.height) // 2, 0)
    canvas.alpha_composite(image, (offset_x, offset_y))
    return canvas


def image_to_data_uri(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def build_cache_key(
    cache_type: str,
    image_path: Path,
    provider_config: dict[str, Any],
    bbox: dict[str, int] | None = None,
    prompt: str = "",
    sheet_context: str = "",
) -> str:
    hasher = hashlib.sha256()
    hasher.update(cache_type.encode("utf-8"))
    hasher.update(hash_file(image_path).encode("utf-8"))
    hasher.update(provider_config.get("baseUrl", "").encode("utf-8"))
    hasher.update(provider_config.get("model", "").encode("utf-8"))
    hasher.update(provider_config.get("sheetPrompt", "").encode("utf-8"))
    hasher.update(provider_config.get("spritePrompt", "").encode("utf-8"))
    hasher.update(prompt.encode("utf-8"))
    hasher.update(sheet_context.encode("utf-8"))
    if bbox:
        hasher.update(json.dumps(bbox, sort_keys=True).encode("utf-8"))
    return hasher.hexdigest()


def get_cache_dir() -> Path:
    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        base = Path(local_app_data)
    else:
        base = Path.home()
    cache_dir = base / "SpriteSplit" / ".spritesplit-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def read_or_generate_cache(cache_key: str, factory: Any) -> str:
    cache_path = get_cache_dir() / f"{cache_key}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        return str(cached["value"])
    value = str(factory()).strip()
    cache_path.write_text(json.dumps({"value": value}, ensure_ascii=False), encoding="utf-8")
    return value


def read_or_generate_json_cache(cache_key: str, factory: Any) -> dict[str, Any]:
    cache_path = get_cache_dir() / f"{cache_key}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        value = cached.get("value", {})
        if isinstance(value, dict):
            return value
        return parse_sprite_metadata_response(str(value))

    value = factory()
    if not isinstance(value, dict):
        value = parse_sprite_metadata_response(str(value))
    cache_path.write_text(json.dumps({"value": value}, ensure_ascii=False), encoding="utf-8")
    return value


def parse_sprite_metadata_response(response: str) -> dict[str, str]:
    text = response.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)

    json_match = re.search(r"\{.*\}", text, flags=re.S)
    if json_match:
        try:
            parsed = json.loads(json_match.group(0))
            if isinstance(parsed, dict):
                return {
                    "name": str(parsed.get("name", "")).strip(),
                    "description": str(parsed.get("description", "")).strip(),
                }
        except json.JSONDecodeError:
            pass

    first_line = next((line.strip() for line in text.splitlines() if line.strip()), text)
    return {
        "name": first_line,
        "description": text,
    }


def hash_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def sanitize_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_") or "sprite"


def sanitize_asset_name(value: str) -> str:
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", normalized).strip("_").lower()
    normalized = re.sub(r"_+", "_", normalized)
    return normalized or "sprite"


def unique_asset_name(base_name: str, used_names: set[str]) -> str:
    candidate = base_name
    suffix = 2
    while candidate in used_names:
        candidate = f"{base_name}_{suffix}"
        suffix += 1
    return candidate


def dedupe_warnings(warnings: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for warning in warnings:
        if warning and warning not in seen:
            ordered.append(warning)
            seen.add(warning)
    return ordered


if __name__ == "__main__":
    main()
