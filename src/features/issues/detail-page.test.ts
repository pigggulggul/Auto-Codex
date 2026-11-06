import { describe, expect, it } from "vitest";
import { validDetailPage } from "./detail-page";

describe("detail page consistency", () => {
  it("accepts complete and partial pages for a fixed total", () => {
    expect(validDetailPage({ items: ["a"], nextOffset: 1 }, 0, 2)).toBe(true);
    expect(validDetailPage({ items: ["b"], nextOffset: null }, 1, 2, ["a"])).toBe(true);
    expect(validDetailPage({ items: [], nextOffset: null }, 0, 0)).toBe(true);
  });
  it("rejects premature ends, excessive counts, incorrect cursors and offsets", () => {
    expect(validDetailPage({ items: [], nextOffset: null }, 0, 1)).toBe(false);
    expect(validDetailPage({ items: ["a", "b"], nextOffset: null }, 0, 1)).toBe(false);
    expect(validDetailPage({ items: ["a"], nextOffset: 2 }, 0, 3)).toBe(false);
    expect(validDetailPage({ items: ["b"], nextOffset: null }, 1, 2, [])).toBe(false);
  });
  it("rejects duplicate requirement or dependency IDs across pages", () => {
    const identity = (item: { id: string }) => item.id;
    expect(validDetailPage({ items: [{ id: "a" }], nextOffset: null }, 1, 2, [{ id: "a" }], identity)).toBe(false);
    expect(validDetailPage({ items: [{ id: "b" }], nextOffset: null }, 1, 2, [{ id: "a" }], identity)).toBe(true);
  });
});
