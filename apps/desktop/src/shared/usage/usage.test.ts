import { describe, expect, it } from 'vitest';

import { contextPercent, runTokens } from './usage';

describe('contextPercent', () => {
  it('rounds the share of the window that is used', () => {
    expect(contextPercent({ contextUsed: 45_000, contextWindow: 131_072 })).toBe(34);
    expect(contextPercent({ contextUsed: 0, contextWindow: 200_000 })).toBe(0);
  });
  it('is null when the window is unknown and never passes 100', () => {
    expect(contextPercent({ contextUsed: 10, contextWindow: null })).toBeNull();
    expect(contextPercent({ contextUsed: 10, contextWindow: 0 })).toBeNull();
    expect(contextPercent({ contextUsed: 300, contextWindow: 200 })).toBe(100);
  });
});

describe('runTokens', () => {
  it('adds sent, written and cache-written tokens but not cache reads', () => {
    expect(
      runTokens({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5_000,
        cacheWriteTokens: 30,
        requests: 2,
        cost: 0,
      }),
    ).toBe(150);
  });
});
