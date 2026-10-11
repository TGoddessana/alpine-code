/** The twelve looks an agent's character can wear (board 캐릭터 모음). More can be added without touching anything else. */
export const LOOKS = [
  'antenna',
  'hardhat',
  'glasses',
  'beret',
  'headphones',
  'cap',
  'chef',
  'sprout',
  'ribbon',
  'beanie',
  'bowtie',
  'grad',
] as const;
export type Look = (typeof LOOKS)[number];

/** The five avatar colours plus teal, grey and apricot. */
export const CHARACTER_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export const FALLBACK_COLOR = 2;

/** Full class names, so the tokens stay visible to the class scanner. */
export const CHARACTER_CLASS: Record<number, { face: string; faceStroke: string; ink: string }> = {
  1: { face: 'fill-avatar-1', faceStroke: 'stroke-avatar-1', ink: 'text-avatar-1-ink' },
  2: { face: 'fill-avatar-2', faceStroke: 'stroke-avatar-2', ink: 'text-avatar-2-ink' },
  3: { face: 'fill-avatar-3', faceStroke: 'stroke-avatar-3', ink: 'text-avatar-3-ink' },
  4: { face: 'fill-avatar-4', faceStroke: 'stroke-avatar-4', ink: 'text-avatar-4-ink' },
  5: { face: 'fill-avatar-5', faceStroke: 'stroke-avatar-5', ink: 'text-avatar-5-ink' },
  6: { face: 'fill-avatar-6', faceStroke: 'stroke-avatar-6', ink: 'text-avatar-6-ink' },
  7: { face: 'fill-avatar-7', faceStroke: 'stroke-avatar-7', ink: 'text-avatar-7-ink' },
  8: { face: 'fill-avatar-8', faceStroke: 'stroke-avatar-8', ink: 'text-avatar-8-ink' },
};
