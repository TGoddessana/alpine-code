import type { SessionInfo, Usage } from '@alpine/protocol';

/** From this share of the context window on, the meter asks for attention: the model will soon summarise the start. */
export const CONTEXT_WARN_PERCENT = 80;

/** How much of the model's memory the conversation uses, in whole percent (0 to 100); `null` when the window is unknown. */
export function contextPercent(info: Pick<SessionInfo, 'contextUsed' | 'contextWindow'>): number | null {
  if (!info.contextWindow || info.contextWindow <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((info.contextUsed / info.contextWindow) * 100)));
}

/**
 * The tokens worth showing as "this run": what was sent, what was written and what was saved to the cache. Cache
 * reads are left out (they are the same text counted again on every request), and the panel lists them apart.
 */
export function runTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens;
}
