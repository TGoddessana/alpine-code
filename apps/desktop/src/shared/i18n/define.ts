export type Locale = 'ko' | 'en';

export const LOCALES: readonly Locale[] = ['ko', 'en'];

type Message = string | ((...args: never[]) => string);

export type Messages<T> = { ko: T; en: NoInfer<T> };

/**
 * Declares one feature's copy. Korean is the source; English must have the same keys, and a message that takes
 * arguments in Korean must take the same arguments in English, or the build fails.
 */
export function defineMessages<T extends Record<string, Message>>(messages: Messages<T>): Messages<T> {
  return messages;
}
