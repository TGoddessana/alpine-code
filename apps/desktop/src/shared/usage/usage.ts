import type { SessionInfo, Usage } from '@alpine/protocol';

/** From this share of the tidy point on, the meter asks for attention: the conversation will soon be tidied. */
export const CONTEXT_WARN_PERCENT = 80;

/**
 * How far the conversation is toward the point where it is tidied (near the end of what the model reads at once, or
 * before a longer prompt costs more), in whole percent (0 to 100); `null` when the model's window is unknown.
 */
export function contextPercent(info: Pick<SessionInfo, 'contextUsed' | 'contextTidyAt'>): number | null {
  if (!info.contextTidyAt || info.contextTidyAt <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((info.contextUsed / info.contextTidyAt) * 100)));
}

/**
 * The tokens worth showing as "this run": what was sent, what was written and what was saved to the cache. Cache
 * reads are left out (they are the same text counted again on every request), and the panel lists them apart.
 */
export function runTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens;
}
