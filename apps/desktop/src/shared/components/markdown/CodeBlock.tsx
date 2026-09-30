import { LinkButton } from '@alpine/ui/primitives';
import { useEffect, useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { colour, colouredBefore, type Tokens } from './highlight';
import { messages } from './messages';

/** How long "Copied" stays before the button says "Copy" again. */
const COPIED_MS = 1500;

/**
 * A fenced code block: the language and a copy button above, the code below. While the fence is still streaming the
 * code is plain; it is coloured once it is closed, so a growing block is not highlighted again on every frame.
 */
export function CodeBlock({ code, language, incomplete }: { code: string; language: string; incomplete: boolean }) {
  const t = useMessages(messages);
  const tokens = useHighlighted(code, language, incomplete);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-line-subtle bg-canvas-sunken">
      <div className="flex min-h-8 items-center justify-between gap-2 pr-2 pl-3 text-meta text-fg-muted">
        <span className="font-mono">{language}</span>
        <LinkButton
          aria-label={copied ? t.copied : t.copyCode(language)}
          onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}
        >
          {copied ? t.copied : t.copy}
        </LinkButton>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-meta text-fg">
        <code>
          {tokens
            ? tokens.map((line, i) => (
                <span key={i}>
                  {i > 0 && '\n'}
                  {line.map((token, j) => (
                    <span key={j} style={{ color: token.htmlStyle?.color ?? token.color }}>
                      {token.content}
                    </span>
                  ))}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}

/**
 * The coloured lines of `code`, or `null` while they are not ready (or the language is unknown, or `skip`). Code
 * coloured before is coloured from the first draw, so a finished reply drawn again does not flash plain.
 */
function useHighlighted(code: string, language: string, skip: boolean): Tokens | null {
  const [arrived, setArrived] = useState<{ code: string; language: string; tokens: Tokens | null } | null>(null);
  const before = skip || !language ? null : colouredBefore(code, language);

  useEffect(() => {
    if (before !== undefined) return;
    return colour(code, language, (tokens) => setArrived({ code, language, tokens }));
  }, [code, language, before]);

  if (before !== undefined) return before;
  return arrived && arrived.code === code && arrived.language === language ? arrived.tokens : null;
}
