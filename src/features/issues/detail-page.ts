import type { Page } from "../../../shared/issues/view";

/** Verify the page against the detail's fixed-revision total before displaying it. */
export function validDetailPage<T>(page: Page<T>, offset: number, total: number, previous: readonly T[] = [], identity?: (item: T) => string): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== previous.length || !Number.isSafeInteger(total) || total < 0) return false;
  const end = offset + page.items.length;
  if (!Number.isSafeInteger(end) || end > total || (page.nextOffset === null ? end !== total : page.items.length === 0 || page.nextOffset !== end || end >= total)) return false;
  if (identity) {
    const ids = new Set(previous.map(identity));
    for (const item of page.items) { const id = identity(item); if (ids.has(id)) return false; ids.add(id); }
  }
  return true;
}
