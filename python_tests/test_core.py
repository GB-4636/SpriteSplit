from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from python.spritesplit_core import OpenAICompatibleProvider, analyze_image, export_project, generate_descriptions


class SpriteSplitCoreTests(unittest.TestCase):
    def test_analyze_image_detects_connected_components_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "sheet.png"
            build_sample_image(image_path)

            result = analyze_image(
                {
                    "imagePath": str(image_path),
                    "settings": {
                        "alphaThreshold": 10,
                        "minArea": 4,
                        "sortMode": "top-to-bottom-left-to-right",
                    },
                }
            )

            self.assertEqual(2, len(result["sprites"]))
            self.assertEqual({"x": 2, "y": 2, "width": 5, "height": 5}, result["sprites"][0]["bbox"])
            self.assertEqual({"x": 12, "y": 10, "width": 6, "height": 4}, result["sprites"][1]["bbox"])

    def test_export_project_writes_manifest_csv_and_crops(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "sheet.png"
            export_dir = Path(temp_dir) / "out"
            build_sample_image(image_path)

            analyzed = analyze_image(
                {
                    "imagePath": str(image_path),
                    "settings": {
                        "alphaThreshold": 10,
                        "minArea": 4,
                        "sortMode": "top-to-bottom-left-to-right",
                    },
                }
            )

            exported = export_project(
                {
                    "project": analyzed,
                    "exportSettings": {
                        "outputDir": str(export_dir),
                        "exportCrops": True,
                        "normalizeCanvas": True,
                        "canvasWidth": 8,
                        "canvasHeight": 8,
                        "includeJson": True,
                        "includeCsv": True,
                    },
                }
            )

            self.assertTrue(Path(exported["manifestPath"]).exists())
            self.assertTrue(Path(exported["csvPath"]).exists())
            self.assertEqual(2, len(exported["exportedSprites"]))
            for crop_path in exported["exportedSprites"]:
                self.assertTrue(Path(crop_path).exists())

    def test_generate_descriptions_renames_sprites_with_ai_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "sheet.png"
            build_sample_image(image_path)
            analyzed = analyze_image(
                {
                    "imagePath": str(image_path),
                    "settings": {
                        "alphaThreshold": 10,
                        "minArea": 4,
                        "sortMode": "top-to-bottom-left-to-right",
                    },
                }
            )

            metadata = {
                "sprite-001": {"name": "Red Fire Orb", "description": "A small red fire orb."},
                "sprite-002": {"name": "green_slime_idle", "description": "A green slime idle frame."},
            }

            with (
                patch.object(OpenAICompatibleProvider, "describe_sheet_context", return_value="pixel fantasy items"),
                patch.object(OpenAICompatibleProvider, "describe_sprite_metadata_batch", return_value=metadata),
            ):
                named = generate_descriptions(
                    {
                        "project": analyzed,
                        "providerConfig": {
                            "enabled": True,
                            "baseUrl": "https://example.test/v1",
                            "apiKey": "test",
                            "model": "vision-test",
                            "sheetPrompt": "context",
                            "spritePrompt": "name sprites",
                        },
                    }
                )

            self.assertEqual("red_fire_orb", named["sprites"][0]["name"])
            self.assertEqual("green_slime_idle", named["sprites"][1]["name"])
            self.assertEqual("A small red fire orb.", named["sprites"][0]["description"])


def build_sample_image(destination: Path) -> None:
    image = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((2, 2, 6, 6), fill=(255, 0, 0, 255))
    draw.rectangle((12, 10, 17, 13), fill=(0, 255, 0, 255))
    image.save(destination)


if __name__ == "__main__":
    unittest.main()
