import { useEffect, useState } from 'react';
import { colour, colouredBefore, type Tokens } from './highlight';
/**
 * The coloured lines of `code`, or `null` while they are not ready (or the language is unknown, or `skip`). Code
 * coloured before is coloured from the first draw, so a finished reply drawn again does not flash plain.
 */
export function useHighlighted(code: string, language: string, skip: boolean): Tokens | null {
  const [arrived, setArrived] = useState<{ code: string; language: string; tokens: Tokens | null } | null>(null);
  const before = skip || !language ? null : colouredBefore(code, language);

  useEffect(() => {
    if (before !== undefined) return;
    return colour(code, language, (tokens) => setArrived({ code, language, tokens }));
  }, [code, language, before]);

  if (before !== undefined) return before;
  return arrived && arrived.code === code && arrived.language === language ? arrived.tokens : null;
}
