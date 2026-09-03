"""Normalize the reviewed character sheets to a 2x4 256px-frame contract."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


FRAME_SIZE = 256
FRAME_COLUMNS = 2
FRAME_ROWS = 4
SOURCE_FRAME_SIZE = 64


def alpha_bbox(image: Image.Image, threshold: int = 16) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A").point(lambda value: 255 if value > threshold else 0)
    return alpha.getbbox()


def normalize_existing_sheet(source: Image.Image) -> Image.Image:
    """Upscale the existing 64px cells without changing their pixel clusters."""
    if source.size == (FRAME_SIZE * FRAME_COLUMNS, FRAME_SIZE * FRAME_ROWS):
        return source.copy()
    if source.size != (256, 256):
        raise ValueError(f"expected a 256x256 source sheet, got {source.size}")

    result = Image.new("RGBA", (FRAME_SIZE * FRAME_COLUMNS, FRAME_SIZE * FRAME_ROWS), (0, 0, 0, 0))
    for row in range(FRAME_ROWS):
        for column in range(FRAME_COLUMNS):
            frame = source.crop(
                (
                    column * SOURCE_FRAME_SIZE,
                    row * SOURCE_FRAME_SIZE,
                    (column + 1) * SOURCE_FRAME_SIZE,
                    (row + 1) * SOURCE_FRAME_SIZE,
                )
            )
            frame = frame.resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.NEAREST)
            result.alpha_composite(frame, (column * FRAME_SIZE, row * FRAME_SIZE))
    return result


def visible_components(source: Image.Image, threshold: int = 32) -> list[tuple[int, int, int, int]]:
    """Return the eight large connected character regions in a repaired sheet."""
    mask = np.asarray(source.getchannel("A")) > threshold
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    components: list[tuple[int, int, int, int, int]] = []

    for start_y in range(height):
        for start_x in range(width):
            if not mask[start_y, start_x] or seen[start_y, start_x]:
                continue
            stack = [(start_y, start_x)]
            seen[start_y, start_x] = True
            min_x = max_x = start_x
            min_y = max_y = start_y
            count = 0
            while stack:
                y, x = stack.pop()
                count += 1
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for delta_y in (-1, 0, 1):
                    for delta_x in (-1, 0, 1):
                        if not delta_x and not delta_y:
                            continue
                        next_y = y + delta_y
                        next_x = x + delta_x
                        if (
                            0 <= next_y < height
                            and 0 <= next_x < width
                            and mask[next_y, next_x]
                            and not seen[next_y, next_x]
                        ):
                            seen[next_y, next_x] = True
                            stack.append((next_y, next_x))
            if count > 1000:
                components.append((count, min_x, min_y, max_x + 1, max_y + 1))

    if len(components) != FRAME_COLUMNS * FRAME_ROWS:
        raise ValueError(f"expected eight repaired character regions, found {len(components)}")
    return [component[1:] for component in sorted(components, key=lambda item: (item[2], item[1]))]


def normalize_repaired_sheet(source: Image.Image) -> Image.Image:
    """Extract the repaired 2x4 sheet produced by ImageGen into square cells.

    The built-in image editor may return a portrait canvas with the repaired
    sheet in its upper-left 512x1536 region. Each extracted frame is cropped
    to its visible alpha and bottom-aligned in a 256px cell.
    """
    if source.width < 512 or source.height < 1536:
        raise ValueError(f"expected a portrait repaired sheet, got {source.size}")

    result = Image.new("RGBA", (FRAME_SIZE * FRAME_COLUMNS, FRAME_SIZE * FRAME_ROWS), (0, 0, 0, 0))
    source = source.convert("RGBA")
    boxes = visible_components(source)
    frames = [source.crop(box) for box in boxes]
    scale = min(
        (FRAME_SIZE - 12) / max(frame.width for frame in frames),
        (FRAME_SIZE - 12) / max(frame.height for frame in frames),
    )
    for index, frame in enumerate(frames):
        frame = frame.resize(
            (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
            Image.Resampling.NEAREST,
        )
        row, column = divmod(index, FRAME_COLUMNS)
        x = column * FRAME_SIZE + (FRAME_SIZE - frame.width) // 2
        y = row * FRAME_SIZE + FRAME_SIZE - frame.height - 4
        result.alpha_composite(frame, (x, y))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--characters-root", type=Path, default=Path(__file__).resolve().parent / "generated-inputs" / "characters")
    parser.add_argument("--runtime-root", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "generated-pixel-assets" / "characters")
    parser.add_argument("--repaired-char3", type=Path)
    args = parser.parse_args()

    args.runtime_root.mkdir(parents=True, exist_ok=True)
    for index in range(5):
        source_path = args.characters_root / f"char_{index}.png"
        if index == 3 and args.repaired_char3:
            source_path = args.repaired_char3
        with Image.open(source_path) as opened:
            source = opened.convert("RGBA")
        sheet = normalize_repaired_sheet(source) if index == 3 and args.repaired_char3 else normalize_existing_sheet(source)
        destination = args.characters_root / f"char_{index}.png"
        sheet.save(destination)
        sheet.save(args.runtime_root / f"char_{index}.png")
        print(f"{destination}: {sheet.size}")


if __name__ == "__main__":
    main()
