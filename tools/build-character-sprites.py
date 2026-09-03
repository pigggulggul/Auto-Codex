"""Build 512x1024 runtime sheets from generated 2x4 character atlases."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


FRAME_WIDTH = 256
FRAME_HEIGHT = 256
SOURCE_COLUMNS = 2
STATE_ROWS = 4
SHEET_COLUMNS = 2


def connected_background(cell: Image.Image, threshold: int = 24) -> Image.Image:
    """Remove a smooth/checkered background without deleting enclosed white clothes."""
    rgba = np.asarray(cell.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    height, width = rgb.shape[:2]
    visited = np.zeros((height, width), dtype=np.bool_)
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(1, height - 1):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if visited[y, x]:
            continue
        visited[y, x] = True
        current = rgb[y, x]
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or nx >= width or ny < 0 or ny >= height or visited[ny, nx]:
                continue
            delta = np.abs(rgb[ny, nx] - current)
            if int(delta.max()) <= threshold and int(delta.sum()) <= threshold * 2:
                queue.append((nx, ny))

    rgba[visited, 3] = 0
    # Some checker cells can become enclosed by hair/tails after downsampling.
    # Clear only neutral near-white pixels; pink-tinted clothing stays intact.
    channel_spread = rgb.max(axis=2) - rgb.min(axis=2)
    neutral_checker = (rgb.min(axis=2) >= 236) & (channel_spread <= 8)
    rgba[neutral_checker, 3] = 0
    return largest_alpha_component(Image.fromarray(rgba, mode="RGBA"))


def largest_alpha_component(image: Image.Image) -> Image.Image:
    """Keep the character body and discard detached glow/checker artifacts."""
    rgba = np.asarray(image.convert("RGBA")).copy()
    alpha = rgba[:, :, 3] > 0
    height, width = alpha.shape
    seen = np.zeros((height, width), dtype=np.bool_)
    largest: list[tuple[int, int]] = []

    for y in range(height):
        for x in range(width):
            if not alpha[y, x] or seen[y, x]:
                continue
            component: list[tuple[int, int]] = []
            queue: deque[tuple[int, int]] = deque([(x, y)])
            seen[y, x] = True
            while queue:
                cx, cy = queue.popleft()
                component.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and alpha[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((nx, ny))
            if len(component) > len(largest):
                largest = component

    keep = np.zeros((height, width), dtype=np.bool_)
    for x, y in largest:
        keep[y, x] = True
    rgba[~keep, 3] = 0
    return Image.fromarray(rgba, mode="RGBA")


def alpha_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    bbox = image.getchannel("A").getbbox()
    return bbox if bbox is not None else (0, 0, image.width, image.height)


def split_frames(source: Image.Image) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for row in range(STATE_ROWS):
        y0 = round(source.height * row / STATE_ROWS)
        y1 = round(source.height * (row + 1) / STATE_ROWS)
        for column in range(SOURCE_COLUMNS):
            x0 = round(source.width * column / SOURCE_COLUMNS)
            x1 = round(source.width * (column + 1) / SOURCE_COLUMNS)
            # The generated atlases are much larger than the runtime frames.
            # Segmenting a compact nearest-neighbour copy is faster
            # and also keeps the authored pixel clusters crisp.
            cell = source.crop((x0, y0, x1, y1)).resize((128, 96), Image.Resampling.NEAREST)
            frames.append(connected_background(cell))
    return frames


def build_sheet(source_path: Path) -> Image.Image:
    with Image.open(source_path) as source:
        frames = split_frames(source.convert("RGBA"))

    bounds = [alpha_bounds(frame) for frame in frames]
    widest = max(right - left for left, _, right, _ in bounds)
    tallest = max(bottom - top for _, top, _, bottom in bounds)
    scale = min((FRAME_WIDTH - 4) / widest, (FRAME_HEIGHT - 4) / tallest)
    sheet = Image.new("RGBA", (FRAME_WIDTH * SHEET_COLUMNS, FRAME_HEIGHT * STATE_ROWS), (0, 0, 0, 0))

    for index, (frame, bbox) in enumerate(zip(frames, bounds, strict=True)):
        cropped = frame.crop(bbox)
        width = max(1, round(cropped.width * scale))
        height = max(1, round(cropped.height * scale))
        compact = cropped.resize((width, height), Image.Resampling.NEAREST)
        # The renderer animates the two cells of each state row. The public
        # contract is a regular 2x4, 512x1024 atlas with eight authored frames.
        column = index % SOURCE_COLUMNS
        row = index // SOURCE_COLUMNS
        x = column * FRAME_WIDTH + (FRAME_WIDTH - width) // 2
        y = row * FRAME_HEIGHT + FRAME_HEIGHT - height - 1
        sheet.alpha_composite(compact, (x, y))

    return sheet


def contact_sheet(sheets: list[Image.Image], destination: Path) -> None:
    scale = 3
    cell_width = FRAME_WIDTH * scale + 12
    cell_height = FRAME_HEIGHT * scale + 20
    preview = Image.new("RGBA", (cell_width * len(sheets), cell_height * STATE_ROWS), (255, 244, 250, 255))
    draw = ImageDraw.Draw(preview)
    labels = ("IDLE", "MOVING", "WORKING", "THINKING")
    for column, sheet in enumerate(sheets):
        for row, label in enumerate(labels):
            frame = sheet.crop((0, row * FRAME_HEIGHT, FRAME_WIDTH, (row + 1) * FRAME_HEIGHT))
            frame = frame.resize((FRAME_WIDTH * scale, FRAME_HEIGHT * scale), Image.Resampling.NEAREST)
            x = column * cell_width + 6
            y = row * cell_height + 18
            preview.alpha_composite(frame, (x, y))
            draw.text((x, row * cell_height + 4), f"{column + 1} {label}", fill=(91, 57, 82, 255))
    destination.parent.mkdir(parents=True, exist_ok=True)
    preview.convert("RGB").save(destination, quality=94)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()

    if len(args.sources) != 5:
        parser.error("exactly five generated 2x4 source atlases are required")

    source_output = args.project_root / "tools" / "generated-inputs" / "characters"
    runtime_output = args.project_root / "public" / "generated-pixel-assets" / "characters"
    sheets: list[Image.Image] = []
    for index, source in enumerate(args.sources):
        sheet = build_sheet(source)
        sheets.append(sheet)
        for root in (source_output, runtime_output):
            root.mkdir(parents=True, exist_ok=True)
            sheet.save(root / f"char_{index}.png")

    contact_sheet(sheets, args.project_root / "docs" / "character-sprites-preview.jpg")


if __name__ == "__main__":
    main()
