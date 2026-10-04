/** Two letters for a project's avatar: the first two of its name, the first upper-case ("alpine-code" -> "Al"). */
export function avatarLetters(name: string): string {
  const [first = '', second = ''] = Array.from(name.trim());
  return first.toUpperCase() + second;
}

/** The avatar colour for a project: the same path always lands on the same one of the five. */
export function avatarSlot(path: string): 1 | 2 | 3 | 4 | 5 {
  let hash = 0;
  for (const char of path) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ((hash % 5) + 1) as 1 | 2 | 3 | 4 | 5;
}

/** Full class names, so the tokens stay visible to the class scanner. */
export const AVATAR_CLASS = {
  1: 'bg-avatar-1 text-avatar-1-ink',
  2: 'bg-avatar-2 text-avatar-2-ink',
  3: 'bg-avatar-3 text-avatar-3-ink',
  4: 'bg-avatar-4 text-avatar-4-ink',
  5: 'bg-avatar-5 text-avatar-5-ink',
} as const;
