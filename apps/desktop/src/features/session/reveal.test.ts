import { describe, expect, it } from 'vitest';

import { REVEAL_MS, revealStep } from './reveal';

const text = '가'.repeat(100);

describe('revealStep', () => {
  it('lets out the share of the backlog that the time passed is of the window', () => {
    expect(revealStep(text, 0, REVEAL_MS / 4)).toBe(25);
    expect(revealStep(text, 60, REVEAL_MS / 4)).toBe(70);
  });

  it('shows everything once the whole window has passed', () => {
    expect(revealStep(text, 10, REVEAL_MS * 3)).toBe(100);
  });

  it('moves at least one character a frame', () => {
    expect(revealStep(text, 99, 1)).toBe(100);
    expect(revealStep(text, 0, 0)).toBe(1);
  });

  it('never goes past the text', () => {
    expect(revealStep(text, 100, 16)).toBe(100);
    expect(revealStep('ab', 5, 16)).toBe(2);
  });

  it('keeps a character made of two code units whole', () => {
    expect(revealStep('a😀b', 1, 0)).toBe(3);
  });
});
