import type { PetState } from "../../shared/protocol";
import { CHARACTER_FRAME_HEIGHT, CHARACTER_FRAME_WIDTH, characterFrame, characterStateRow, characterWalkFrame } from "./pixelWorld";

export type SpriteBounds = { x: number; y: number; width: number; height: number };

export function alphaBounds(width: number, height: number, rgba: Uint8ClampedArray): SpriteBounds | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] <= 8) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Authored front-facing gait: routing direction must never mirror identity. */
export function drawCharacterSprite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  pose: { state: PetState; moving: boolean; travelled: number; elapsedSeconds: number; reducedMotion: boolean },
  destination: SpriteBounds,
): void {
  const frame = pose.reducedMotion ? 0 : pose.moving ? characterWalkFrame(pose.travelled) : characterFrame(pose.state, false, pose.elapsedSeconds);
  const row = characterStateRow(pose.state, pose.moving);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, frame * CHARACTER_FRAME_WIDTH, row * CHARACTER_FRAME_HEIGHT, CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT,
    destination.x, destination.y, destination.width, destination.height);
  ctx.restore();
}
