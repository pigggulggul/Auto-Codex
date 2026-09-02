import type { TokenUsageEntry, TokenUsageSummary } from "../../shared/protocol";

const STORAGE_KEY = "auto-codex.token-usage.v1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfToday(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function mergeTokenUsage(entries: TokenUsageEntry[], next: TokenUsageEntry, now = new Date()): TokenUsageEntry[] {
  const cutoff = now.getTime() - WEEK_MS;
  return [...entries.filter((entry) => entry.turnId !== next.turnId), next]
    .filter((entry) => Date.parse(entry.timestamp) >= cutoff)
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export function summarizeTokenUsage(entries: TokenUsageEntry[], now = new Date()): TokenUsageSummary {
  const todayStart = startOfToday(now);
  const weekStart = now.getTime() - WEEK_MS;
  return entries.reduce<TokenUsageSummary>((summary, entry, index) => {
    const timestamp = Date.parse(entry.timestamp);
    if (timestamp >= todayStart) summary.today += entry.totalTokens;
    if (timestamp >= weekStart) summary.week += entry.totalTokens;
    if (index === 0) summary.lastTurn = entry.totalTokens;
    return summary;
  }, { today: 0, week: 0, lastTurn: 0 });
}

export function loadTokenUsage(): TokenUsageEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as TokenUsageEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.turnId === "string" && Number.isFinite(entry.totalTokens)) : [];
  } catch {
    return [];
  }
}

export function saveTokenUsage(entries: TokenUsageEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
