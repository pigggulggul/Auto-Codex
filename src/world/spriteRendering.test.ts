import { describe, expect, it, vi } from "vitest";
import { alphaBounds, drawCharacterSprite } from "./spriteRendering";

describe("authored character orientation", () => {
  it("keeps all five identities unmirrored through every walking direction and phase", () => {
    const drawImage = vi.fn();
    const scale = vi.fn(() => { throw new Error("Character identity must never be mirrored"); });
    const translate = vi.fn();
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage, scale, translate } as unknown as CanvasRenderingContext2D;
    const headings = [{ x: 32, y: 48 }, { x: 64, y: 48 }, { x: 64, y: 80 }, { x: 32, y: 80 }];
    for (let character = 0; character < 5; character++) {
      const image = { character } as unknown as CanvasImageSource;
      for (const heading of headings) for (const travelled of [0, 8, 16, 24]) {
        drawCharacterSprite(ctx, image, { state: "idle", moving: true, travelled, elapsedSeconds: 99, reducedMotion: false }, { ...heading, width: 96, height: 96 });
        const call = drawImage.mock.calls.at(-1)!;
        expect(call[0]).toBe(image);
        expect(call.slice(1, 5)).toEqual([travelled % 16 === 0 ? 0 : 256, 256, 256, 256]);
        expect(call.slice(5)).toEqual([heading.x, heading.y, 96, 96]);
      }
    }
    expect(scale).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalledTimes(80);
    expect(ctx.restore).toHaveBeenCalledTimes(80);
  });

  it("keeps reduced-motion frames still", () => {
    const drawImage = vi.fn();
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D;
    for (const travelled of [8, 24, 40]) drawCharacterSprite(ctx, {} as CanvasImageSource,
      { state: "idle", moving: true, travelled, elapsedSeconds: 99, reducedMotion: true }, { x: 0, y: 0, width: 96, height: 96 });
    expect(drawImage.mock.calls.every((call) => call[1] === 0)).toBe(true);
  });
});

describe("prop alpha bounds", () => {
  it("ignores transparent padding while retaining the complete visible silhouette", () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (const [x, y] of [[2, 1], [5, 6], [3, 4]]) rgba[(y * 8 + x) * 4 + 3] = 255;
    expect(alphaBounds(8, 8, rgba)).toEqual({ x: 2, y: 1, width: 4, height: 6 });
    expect(alphaBounds(2, 2, new Uint8ClampedArray(16))).toBeNull();
  });
});
